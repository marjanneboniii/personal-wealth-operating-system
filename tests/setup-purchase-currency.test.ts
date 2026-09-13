/**
 * Setup — every holding is entered in the currency it was BOUGHT with.
 *
 *   Toman         bank balance, physical gold, TSE funds
 *   Tether/Toman  crypto (a tether itself is priced in Toman)
 *
 * All Toman amounts convert at the ONE rate the user confirmed, the book stays
 * in USD, and that rate is frozen on the opening entry — which is where the
 * portfolio reads each opening position's historical Toman cost from. Before
 * this, a fund priced «۳۰٬۰۰۰» in the wizard was booked as $30,000 per unit,
 * and no opening position had a Toman cost at all.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { and, eq } from "drizzle-orm";
import { db } from "../src/db";
import { createSchemaIfNotExists } from "../src/db/init-schema";
import {
  accounts,
  assets,
  entryFxSnapshots,
  exchangeRates,
  journalEntries,
  lotConsumptions,
  lots,
  postings,
  settings,
  userFxSettings,
  userSetupState,
  users,
} from "../src/db/schema";
import { completeSetup } from "../src/features/setup/service";
import { D } from "../src/domain/decimal";

const RATE = "100000";

async function setupFreshDb() {
  await createSchemaIfNotExists();
  await db.delete(lotConsumptions);
  await db.delete(lots);
  await db.delete(postings);
  await db.delete(journalEntries);
  await db.delete(userSetupState);
  await db.delete(userFxSettings);
  await db.delete(exchangeRates);
  await db.delete(settings);
  await db.delete(users);
  await db.delete(accounts);
}

const baseInput = {
  userName: "خانواده",
  baseCurrency: "USD",
  displayCurrency: "IRT",
  dateCalendar: "jalali" as const,
  digitStyle: "fa" as const,
};

test("Toman- and Tether-priced holdings are booked at the confirmed rate and keep their Toman cost", async () => {
  await setupFreshDb();
  const [user] = await db
    .insert(users)
    .values({ name: "Toman owner", username: "setup-purchase-currency", role: "user" } as any)
    .returning();

  const result = await completeSetup(
    {
      ...baseInput,
      fxRate: RATE,
      bankAccountName: "ملت جاری",
      bankAssetSymbol: "IRT",
      bankOpeningBalance: "50000000", // → $500
      cryptoHoldings: [
        { symbol: "BTC", quantity: "0.01", unitPrice: "60000", priceCurrency: "USDT" }, // → $600
        { symbol: "USDT", quantity: "200", unitPrice: "95000", priceCurrency: "IRT" }, // 19,000,000 T → $190
      ],
      goldOpeningQty: "10",
      goldUnitPrice: "5000000",
      goldPriceCurrency: "IRT", // 50,000,000 T → $500
      instruments: [{ kind: "fund", symbol: "عیار", quantity: "1000", unitPrice: "30000", priceCurrency: "IRT" }], // 30,000,000 T → $300
    },
    user.id,
  );
  assert.equal(result.ok, true, result.message);

  const chart = await db.select().from(accounts).where(eq(accounts.userId, user.id));
  const byCode = new Map(chart.map((a) => [a.code, a]));
  assert.match(byCode.get("1200")?.name ?? "", /بیت‌کوین/, "each coin gets its own wallet");
  assert.match(byCode.get("1201")?.name ?? "", /تتر/, "…including a second one");

  const [entry] = await db
    .select()
    .from(journalEntries)
    .where(and(eq(journalEntries.userId, user.id), eq(journalEntries.type, "opening")));
  assert.ok(entry, "one opening entry");
  const lines = await db.select().from(postings).where(eq(postings.entryId, entry.id));
  const baseOf = (code: string) => D(lines.find((l) => l.accountId === byCode.get(code)?.id)?.baseValue ?? "0").toFixed(2);

  assert.equal(baseOf("1010"), "500.00", "Toman bank balance ÷ confirmed rate");
  assert.equal(baseOf("1200"), "600.00", "a Tether price is booked at face");
  assert.equal(baseOf("1201"), "190.00", "a tether bought with Toman ÷ confirmed rate");
  assert.equal(baseOf("1300"), "500.00", "gold priced per gram in Toman ÷ confirmed rate");
  assert.equal(baseOf("3010"), "-2090.00", "equity balances the whole opening, fund included");

  const [fund] = await db.select().from(assets).where(eq(assets.symbol, "عیار"));
  const fundLine = lines.find((l) => l.assetId === fund.id && l.accountId !== byCode.get("3010")?.id);
  assert.equal(D(fundLine?.baseValue ?? "0").toFixed(2), "300.00", "a fund priced in Toman is not booked as dollars");

  const [snapshot] = await db.select().from(entryFxSnapshots).where(eq(entryFxSnapshots.entryId, entry.id));
  assert.ok(snapshot, "the setup rate is frozen on the opening entry");
  assert.equal(D(snapshot.fxRate).toFixed(0), RATE);
  assert.equal(D(snapshot.usdAmount).toFixed(2), "2090.00");

  // Historical Toman cost = qty × unit_cost_base × frozen rate — the price the user typed.
  const [goldLot] = await db
    .select()
    .from(lots)
    .where(and(eq(lots.userId, user.id), eq(lots.accountId, byCode.get("1300")!.id)));
  assert.equal(D(goldLot.qtyOpened).mul(goldLot.unitCostBase).mul(snapshot.fxRate).toFixed(0), "50000000");
});

test("a non-USD «base currency» no longer re-points the chart away from the USD book", async () => {
  await setupFreshDb();
  const [user] = await db
    .insert(users)
    .values({ name: "Legacy choice", username: "setup-base-currency", role: "user" } as any)
    .returning();

  const result = await completeSetup({ ...baseInput, baseCurrency: "IRT", fxRate: RATE }, user.id);
  assert.equal(result.ok, true, result.message);

  const [usd] = await db.select().from(assets).where(eq(assets.symbol, "USD"));
  const chart = await db.select().from(accounts).where(eq(accounts.userId, user.id));
  for (const code of ["2010", "3010", "4010", "5010", "5960"]) {
    assert.equal(chart.find((a) => a.code === code)?.assetId, usd.id, `${code} stays on the USD book`);
  }
});
