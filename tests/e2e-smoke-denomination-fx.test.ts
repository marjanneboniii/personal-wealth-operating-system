/**
 * Final E2E smoke — real services + existing conversion helpers.
 * Does not mutate production schema. Isolated in-memory DB via test process.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { eq, sql } from "drizzle-orm";
import { db } from "../src/db";
import { createSchemaIfNotExists } from "../src/db/init-schema";
import {
  accounts,
  assetClasses,
  assets,
  currencies,
  journalEntries,
  lotConsumptions,
  lots,
  postings,
  prices,
  userFxSettings,
  users,
} from "../src/db/schema";
import { registerMoneyAccount } from "../src/features/accounts/service";
import { recordFx, recordTransfer, resolveFxBookLegs } from "../src/features/ledger/service";
import { getAccountBalances, getCashflow, getLedger, getNetWorth } from "../src/features/ledger/queries";
import { D } from "../src/domain/decimal";
import { formatDualMoneyFromIrt, irtToUsd } from "../src/lib/format";

async function wipe() {
  await createSchemaIfNotExists();
  await db.delete(lotConsumptions);
  await db.delete(lots);
  await db.delete(postings);
  await db.delete(journalEntries);
  await db.delete(accounts);
  await db.delete(prices);
  await db.delete(assets);
  await db.delete(assetClasses);
  await db.delete(userFxSettings);
  await db.delete(users);
  await db.delete(currencies);
}

test("E2E smoke scenarios 1–10: denomination, preview, transfer, FX, FIFO, tamper", async () => {
  await wipe();

  const [usd] = await db.insert(currencies).values({ code: "USD", name: "USD", symbol: "$", decimals: 2, isFiat: true } as any).returning();
  const [irt] = await db.insert(currencies).values({ code: "IRT", name: "IRT", symbol: "T", decimals: 0, isFiat: true } as any).returning();
  const [cashCls] = await db.insert(assetClasses).values({ code: "cash", name: "نقد و بانک", sortOrder: 1 } as any).returning();
  const [usdAsset] = await db.insert(assets).values({ symbol: "USD", name: "دلار آمریکا", classId: cashCls.id, currencyId: usd.id, decimals: 2 } as any).returning();
  const [irtAsset] = await db.insert(assets).values({ symbol: "IRT", name: "تومان", classId: cashCls.id, currencyId: irt.id, decimals: 0 } as any).returning();
  await db.insert(prices).values([
    { assetId: usdAsset.id, asOf: "2026-01-01", priceBase: "1", source: "manual" },
    { assetId: irtAsset.id, asOf: "2026-01-01", priceBase: "0.00005", source: "manual" },
  ]);
  const [user] = await db.insert(users).values({ name: "Smoke", role: "owner" } as any).returning();
  await db.insert(userFxSettings).values({ userId: user.id, currentRate: "20000" });
  await db.insert(accounts).values({
    code: "3010",
    name: "سرمایه افتتاحیه",
    type: "equity",
    assetId: usdAsset.id,
    userId: user.id,
  } as any);

  /* 1 — Main Bank IRT */
  const bank = await registerMoneyAccount({
    name: "Main Bank",
    kind: "bank",
    assetId: irtAsset.id,
    openingQty: "200000000",
    userId: user.id,
  });
  assert.equal(bank.ok, true);
  const [bankRow] = await db.select().from(accounts).where(eq(accounts.id, bank.accountId!));
  assert.equal(bankRow.assetId, irtAsset.id);

  /* 2 — Cash Wallet USD */
  const cash = await registerMoneyAccount({
    name: "Cash Wallet",
    kind: "cash",
    assetId: usdAsset.id,
    openingQty: "1000",
    userId: user.id,
  });
  assert.equal(cash.ok, true);
  const [cashRow] = await db.select().from(accounts).where(eq(accounts.id, cash.accountId!));
  assert.equal(cashRow.assetId, usdAsset.id);

  /* 3 — existing IRT → USD preview path (not duplicated) */
  const preview = formatDualMoneyFromIrt("100000000", "20000");
  assert.equal(irtToUsd("100000000", "20000"), "5000.00");
  assert.match(preview.usd, /۵٬۰۰۰\u00A0\$/);

  /* 4 — same-currency IRT transfer */
  const bank2 = await registerMoneyAccount({
    name: "Main Bank 2",
    kind: "bank",
    assetId: irtAsset.id,
    openingQty: "0",
    userId: user.id,
  });
  await recordTransfer({
    entryDate: "2026-03-01",
    description: "smoke IRT transfer",
    fromAccountId: bank.accountId!,
    toAccountId: bank2.accountId!,
    assetId: irtAsset.id,
    quantity: "10000000",
    unitPrice: "0.00005",
    userId: user.id,
  });
  const [xfer] = await db.select().from(journalEntries).where(eq(journalEntries.description, "smoke IRT transfer"));
  assert.equal(xfer.type, "transfer");

  const lotsBeforeFx = await db.select().from(lots);
  const consumptionsBefore = await db.select().from(lotConsumptions);

  /* 5 — FX IRT → USD */
  const legs = resolveFxBookLegs({
    fromSymbol: "IRT",
    toSymbol: "USD",
    rateIrtPerUsd: "20000",
    fromQuantity: "100000000",
  });
  assert.equal(D(legs.bookValue).toString(), "5000");
  assert.equal(D(legs.toQuantity).toString(), "5000");
  const fxEntry = await recordFx({
    entryDate: "2026-03-02",
    description: "smoke FX",
    fromAccountId: bank.accountId!,
    toAccountId: cash.accountId!,
    fromAssetId: irtAsset.id,
    toAssetId: usdAsset.id,
    ...legs,
    rateIrtPerUsd: "20000",
    userId: user.id,
  });
  const [fxJe] = await db.select().from(journalEntries).where(eq(journalEntries.id, fxEntry.id));
  assert.equal(fxJe.type, "fx");
  const fxLines = await db.select().from(postings).where(eq(postings.entryId, fxEntry.id));
  assert.equal(fxLines.length, 2);
  assert.ok(fxLines.every((l) => D(l.baseValue).abs().toString() === "5000"));
  const fxSum = fxLines.reduce((s, l) => s.add(l.baseValue), D("0"));
  assert.equal(fxSum.isZero(), true);

  /* 10 — FIFO untouched by FX */
  assert.equal((await db.select().from(lots)).length, lotsBeforeFx.length);
  assert.equal((await db.select().from(lotConsumptions)).length, consumptionsBefore.length);

  /* 6 — rate change does not rewrite posted base_value */
  const before = fxLines.map((l) => l.baseValue);
  await db.update(userFxSettings).set({ currentRate: "999999" }).where(eq(userFxSettings.userId, user.id));
  const after = await db.select().from(postings).where(eq(postings.entryId, fxEntry.id));
  assert.deepEqual(after.map((l) => l.baseValue).sort(), [...before].sort());

  /* 7 — recordTransfer IRT → USD rejected */
  await assert.rejects(
    () =>
      recordTransfer({
        entryDate: "2026-03-03",
        description: "illegal",
        fromAccountId: bank.accountId!,
        toAccountId: cash.accountId!,
        assetId: irtAsset.id,
        quantity: "1",
        unitPrice: "1",
        userId: user.id,
      }),
    (err: any) => err?.code === "CROSS_CURRENCY_USE_FX" || /تبدیل ارز/.test(String(err)),
  );

  /* 8 — forged bookValue */
  assert.throws(
    () =>
      resolveFxBookLegs({
        fromSymbol: "IRT",
        toSymbol: "USD",
        rateIrtPerUsd: "20000",
        fromQuantity: "100000000",
        claimedBookValue: "1",
      }),
    /bookValue/,
  );

  /* 9 — ledger surfaces remain consistent */
  const balances = await getAccountBalances(user.id);
  const bankBal = balances.find((b) => b.accountId === bank.accountId)!;
  const cashBal = balances.find((b) => b.accountId === cash.accountId)!;
  assert.equal(bankBal.symbol, "IRT");
  assert.equal(cashBal.symbol, "USD");
  assert.ok(D(bankBal.quantity).gt(0));
  assert.ok(D(cashBal.baseValue).gt(0));

  const control = balances.reduce((s, b) => s.add(b.baseValue), D("0"));
  assert.ok(control.abs().lt("0.0001"), `control sum ${control}`);

  const ledger = await getLedger(50, user.id);
  assert.ok(ledger.some((r) => r.type === "fx"));
  assert.ok(ledger.some((r) => r.type === "transfer"));

  const nw = await getNetWorth(user.id);
  assert.ok(D(nw.netWorth).gt(0));

  await getCashflow(6, user.id);

  const unbalanced = await db.execute(sql`
    select je.id from journal_entries je
    join postings p on p.entry_id = je.id
    group by je.id having abs(sum(p.base_value)) > 0.000000001
  `);
  assert.equal(unbalanced.rows.length, 0);
});
