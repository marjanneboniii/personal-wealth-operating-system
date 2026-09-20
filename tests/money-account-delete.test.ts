/**
 * «حذف حساب» — deleting a money account the user registered.
 *
 * A user registers an account by mistake, or their bank suspends it, and they
 * want it gone. The ledger is immutable, so the feature has exactly two honest
 * outcomes and one refusal, and this file pins all three plus the tenancy and
 * chart-integrity guards around them:
 *
 *   • «full»    — the account's whole history is its OWN standalone opening
 *                 entry → that entry is reversed and the account disappears
 *                 without leaving a trace in net worth.
 *   • «archive» — the account has real history but a zero balance → the
 *                 account row is hidden and every journal entry, posting and
 *                 report figure stays byte-for-byte identical.
 *   • refused   — a non-zero balance. Hiding it would delete money from net
 *                 worth and break the Σ = 0 control sum.
 *
 * The accounting core is never modified by any of these paths: the only ledger
 * write is a `reverseEntry` mirror.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { and, eq, sql } from "drizzle-orm";
import { db } from "../src/db";
import { createSchemaIfNotExists } from "../src/db/init-schema";
import {
  accounts,
  assetClasses,
  assets,
  auditLog,
  currencies,
  exchangeRates,
  funds,
  goals,
  journalEntries,
  lotConsumptions,
  lots,
  plannedTransactions,
  postings,
  prices,
  settings,
  userFxSettings,
  users,
  wallets,
} from "../src/db/schema";
import {
  deleteMoneyAccount,
  previewMoneyAccountDeletion,
  registerMoneyAccount,
} from "../src/features/accounts/service";
import { getAccountBalances } from "../src/features/ledger/queries";
import { postEntry, recordTransfer } from "../src/features/ledger/service";
import { D, Decimal } from "../src/domain/decimal";

async function setup() {
  await createSchemaIfNotExists();
  await db.delete(lotConsumptions);
  await db.delete(lots);
  await db.delete(postings);
  await db.delete(journalEntries);
  await db.delete(plannedTransactions);
  await db.delete(goals);
  await db.delete(funds);
  await db.delete(accounts);
  await db.delete(wallets);
  await db.delete(prices);
  await db.delete(assets);
  await db.delete(assetClasses);
  await db.delete(auditLog);
  await db.delete(userFxSettings);
  await db.delete(exchangeRates);
  await db.delete(settings);
  await db.delete(users);
  await db.delete(currencies);

  const [user] = await db.insert(users).values({ name: "Owner", role: "owner" } as any).returning();
  const [other] = await db.insert(users).values({ name: "Stranger", role: "owner" } as any).returning();
  await db.insert(userFxSettings).values({ userId: user.id, currentRate: "100000" });

  // `registerMoneyAccount` bootstraps the currency catalog itself; this only
  // needs the IRT/USD/USDT asset ids back afterwards.
  const currencyRows = await (await import("../src/features/accounts/service")).listMoneyAccountCurrencies();
  const irt = currencyRows.find((c) => c.symbol === "IRT")!;
  const usdt = currencyRows.find((c) => c.symbol === "USDT")!;
  return { user, other, irt, usdt };
}

/** Σ(base_value) over LIVE accounts — the invariant the accounts page asserts. */
async function controlSum(userId: string): Promise<string> {
  const balances = await getAccountBalances(userId);
  return balances.reduce((s, b) => s.add(b.baseValue), Decimal.zero()).toString();
}

const liveAccountIds = async (userId: string) =>
  (await getAccountBalances(userId)).map((b) => b.accountId);

test("«full» — an account whose only entry is its own opening entry is deleted without a trace", async () => {
  const fx = await setup();
  const created = await registerMoneyAccount({
    name: "بانک اشتباهی",
    kind: "bank",
    assetId: fx.irt.id,
    openingQty: "50000000",
    userId: fx.user.id,
  });
  assert.ok(created.accountId);
  assert.equal(await controlSum(fx.user.id), "0");

  const preview = await previewMoneyAccountDeletion({ accountId: created.accountId!, userId: fx.user.id });
  assert.equal(preview.mode, "full");
  assert.equal(preview.canDelete, true);
  assert.equal(preview.blockedReason, null);
  assert.equal(preview.entryCount, 1);
  assert.equal(preview.reversesOpeningEntry, true);
  assert.equal(preview.removesWallet, true);
  assert.equal(D(preview.quantity).toString(), "50000000");

  const result = await deleteMoneyAccount({ accountId: created.accountId!, userId: fx.user.id });
  assert.equal(result.ok, true);
  assert.equal(result.mode, "full");
  assert.ok(result.reversalEntryId);

  // Gone from the money page, and the ledger still balances to zero.
  assert.ok(!(await liveAccountIds(fx.user.id)).includes(created.accountId!));
  assert.equal(await controlSum(fx.user.id), "0");

  // The opening entry is VOID, not erased — the ledger stays immutable.
  const [opening] = await db.select().from(journalEntries).where(eq(journalEntries.id, created.entryId!));
  assert.equal(opening.status, "void");
  const [reversal] = await db.select().from(journalEntries).where(eq(journalEntries.id, result.reversalEntryId!));
  assert.equal(reversal.reversalOf, created.entryId);
  assert.equal(reversal.userId, fx.user.id);

  // The wallet container went with its last account.
  const [wallet] = await db.select().from(wallets).where(eq(wallets.id, created.walletId!));
  assert.ok(wallet.deletedAt);

  const [audit] = await db.select().from(auditLog).where(eq(auditLog.action, "DELETE_MONEY_ACCOUNT"));
  assert.ok(audit);
});

test("«full» — a zero-balance account with no entries at all is deleted too", async () => {
  const fx = await setup();
  const created = await registerMoneyAccount({
    name: "کیف خالی",
    kind: "cash",
    assetId: fx.irt.id,
    userId: fx.user.id,
  });
  assert.equal(created.entryId, undefined);

  const preview = await previewMoneyAccountDeletion({ accountId: created.accountId!, userId: fx.user.id });
  assert.equal(preview.entryCount, 0);
  assert.equal(preview.mode, "archive");
  assert.equal(preview.canDelete, true);

  const result = await deleteMoneyAccount({ accountId: created.accountId!, userId: fx.user.id });
  assert.equal(result.ok, true);
  assert.ok(!(await liveAccountIds(fx.user.id)).includes(created.accountId!));
  assert.equal(await controlSum(fx.user.id), "0");
});

test("«archive» — an account with real history but zero balance keeps every ledger row", async () => {
  const fx = await setup();
  const keep = await registerMoneyAccount({
    name: "بانک اصلی",
    kind: "bank",
    assetId: fx.irt.id,
    openingQty: "80000000",
    userId: fx.user.id,
  });
  const blocked = await registerMoneyAccount({
    name: "بانک مسدودشده",
    kind: "bank",
    assetId: fx.irt.id,
    openingQty: "20000000",
    userId: fx.user.id,
  });

  // The user empties the blocked account into the one they keep.
  await recordTransfer({
    entryDate: "2026-03-01",
    description: "تخلیه حساب مسدودشده",
    fromAccountId: blocked.accountId!,
    toAccountId: keep.accountId!,
    assetId: fx.irt.id,
    quantity: "20000000",
    unitPrice: D("1").div("100000").toString(),
    userId: fx.user.id,
  });

  const entriesBefore = (await db.select().from(journalEntries)).length;
  const postingsBefore = (await db.select().from(postings)).length;
  const sumBefore = await controlSum(fx.user.id);

  const preview = await previewMoneyAccountDeletion({ accountId: blocked.accountId!, userId: fx.user.id });
  assert.equal(preview.mode, "archive");
  assert.equal(preview.canDelete, true);
  assert.equal(preview.entryCount, 2);
  assert.equal(preview.reversesOpeningEntry, false);
  assert.equal(D(preview.quantity).isZero(), true);

  const result = await deleteMoneyAccount({ accountId: blocked.accountId!, userId: fx.user.id });
  assert.equal(result.ok, true);
  assert.equal(result.mode, "archive");
  assert.equal(result.reversalEntryId, undefined);

  // NOT ONE ledger row was added, removed or voided.
  assert.equal((await db.select().from(journalEntries)).length, entriesBefore);
  assert.equal((await db.select().from(postings)).length, postingsBefore);
  assert.equal(
    (await db.select().from(journalEntries).where(eq(journalEntries.status, "void"))).length,
    0,
  );
  assert.equal(await controlSum(fx.user.id), sumBefore);

  const live = await getAccountBalances(fx.user.id);
  assert.ok(!live.some((b) => b.accountId === blocked.accountId));
  const kept = live.find((b) => b.accountId === keep.accountId);
  assert.equal(D(kept!.quantity).toString(), "100000000");
});

test("refused — an account that still holds money is never hidden", async () => {
  const fx = await setup();
  const a = await registerMoneyAccount({
    name: "حساب یک",
    kind: "bank",
    assetId: fx.irt.id,
    openingQty: "30000000",
    userId: fx.user.id,
  });
  const b = await registerMoneyAccount({
    name: "حساب دو",
    kind: "bank",
    assetId: fx.irt.id,
    openingQty: "10000000",
    userId: fx.user.id,
  });
  // A second entry makes the opening entry non-reversible; the balance stays.
  await recordTransfer({
    entryDate: "2026-03-01",
    description: "انتقال جزئی",
    fromAccountId: a.accountId!,
    toAccountId: b.accountId!,
    assetId: fx.irt.id,
    quantity: "5000000",
    unitPrice: D("1").div("100000").toString(),
    userId: fx.user.id,
  });

  const preview = await previewMoneyAccountDeletion({ accountId: a.accountId!, userId: fx.user.id });
  assert.equal(preview.canDelete, false);
  assert.match(preview.blockedReason ?? "", /موجودی/);

  await assert.rejects(() => deleteMoneyAccount({ accountId: a.accountId!, userId: fx.user.id }), /موجودی/);
  assert.ok((await liveAccountIds(fx.user.id)).includes(a.accountId!));
  assert.equal(await controlSum(fx.user.id), "0");
});

test("a shared opening entry is never reversed — one setup account cannot wipe another's balance", async () => {
  const fx = await setup();
  // Reproduce the setup wizard's shape: ONE opening entry covering two
  // accounts plus the equity leg.
  const [wallet] = await db.insert(wallets).values({ userId: fx.user.id, name: "خانه", kind: "cash" } as any).returning();
  const [assetRow] = await db.select().from(assets).where(eq(assets.symbol, "IRT"));
  const [usdRow] = await db.select().from(assets).where(eq(assets.symbol, "USD"));
  const [bank] = await db
    .insert(accounts)
    .values({ userId: fx.user.id, code: "1010", name: "بانک راه‌اندازی", type: "asset", assetId: assetRow.id, walletId: wallet.id } as any)
    .returning();
  const [cashBox] = await db
    .insert(accounts)
    .values({ userId: fx.user.id, code: "1020", name: "صندوق نقد", type: "asset", assetId: assetRow.id } as any)
    .returning();
  const [equity] = await db
    .insert(accounts)
    .values({ userId: fx.user.id, code: "3010", name: "سرمایه افتتاحیه", type: "equity", assetId: usdRow.id } as any)
    .returning();
  await postEntry({
    entryDate: "2026-01-01",
    type: "opening",
    description: "راه‌اندازی اولیه",
    userId: fx.user.id,
    postings: [
      { accountId: bank.id, assetId: assetRow.id, quantity: "100000000", baseValue: "1000" },
      { accountId: cashBox.id, assetId: assetRow.id, quantity: "20000000", baseValue: "200" },
      { accountId: equity.id, assetId: usdRow.id, quantity: "-1200", baseValue: "-1200" },
    ],
  });

  // The shared entry is NOT this account's own, so it is not reversible and a
  // non-zero balance refuses the deletion instead of nuking the cash box too.
  const preview = await previewMoneyAccountDeletion({ accountId: bank.id, userId: fx.user.id });
  assert.equal(preview.reversesOpeningEntry, false);
  assert.equal(preview.canDelete, false);
  await assert.rejects(() => deleteMoneyAccount({ accountId: bank.id, userId: fx.user.id }), /موجودی/);

  const live = await getAccountBalances(fx.user.id);
  assert.equal(D(live.find((b) => b.accountId === cashBox.id)!.quantity).toString(), "20000000");
  assert.equal(await controlSum(fx.user.id), "0");
});

test("a multi-account wallet survives until its last account is deleted", async () => {
  const fx = await setup();
  const first = await registerMoneyAccount({ name: "تتر - صرافی", kind: "exchange", assetId: fx.usdt.id, userId: fx.user.id });
  // Second account in the SAME wallet, as a holding-per-coin chart produces.
  const [second] = await db
    .insert(accounts)
    .values({
      userId: fx.user.id,
      code: "1777",
      name: "تومان - صرافی",
      type: "asset",
      assetId: fx.irt.id,
      walletId: first.walletId,
    } as any)
    .returning();

  const preview = await previewMoneyAccountDeletion({ accountId: first.accountId!, userId: fx.user.id });
  assert.equal(preview.removesWallet, false);
  await deleteMoneyAccount({ accountId: first.accountId!, userId: fx.user.id });
  const [walletAfterFirst] = await db.select().from(wallets).where(eq(wallets.id, first.walletId!));
  assert.equal(walletAfterFirst.deletedAt, null);

  await deleteMoneyAccount({ accountId: second.id, userId: fx.user.id });
  const [walletAfterSecond] = await db.select().from(wallets).where(eq(wallets.id, first.walletId!));
  assert.ok(walletAfterSecond.deletedAt);
});

test("planning links attached to the account are detached, and pending plans cancelled", async () => {
  const fx = await setup();
  const created = await registerMoneyAccount({ name: "حساب هدف", kind: "bank", assetId: fx.irt.id, userId: fx.user.id });
  const [goal] = await db
    .insert(goals)
    .values({ userId: fx.user.id, name: "سفر", targetBase: "1000", fundAccountId: created.accountId } as any)
    .returning();
  const [fund] = await db
    .insert(funds)
    .values({ userId: fx.user.id, name: "اضطراری", kind: "emergency", targetBase: "500", accountId: created.accountId } as any)
    .returning();
  const [plan] = await db
    .insert(plannedTransactions)
    .values({
      userId: fx.user.id,
      title: "اجاره",
      plannedDate: "2026-04-01",
      direction: "outflow",
      amountBase: "100",
      fromAccountId: created.accountId,
    } as any)
    .returning();

  const preview = await previewMoneyAccountDeletion({ accountId: created.accountId!, userId: fx.user.id });
  assert.equal(preview.linkedGoals, 1);
  assert.equal(preview.linkedFunds, 1);
  assert.equal(preview.plannedTransactions, 1);

  await deleteMoneyAccount({ accountId: created.accountId!, userId: fx.user.id });

  assert.equal((await db.select().from(goals).where(eq(goals.id, goal.id)))[0].fundAccountId, null);
  assert.equal((await db.select().from(funds).where(eq(funds.id, fund.id)))[0].accountId, null);
  assert.equal(
    (await db.select().from(plannedTransactions).where(eq(plannedTransactions.id, plan.id)))[0].status,
    "cancelled",
  );
});

test("tenancy — another user's account is unreachable, and the chart backbone is protected", async () => {
  const fx = await setup();
  const mine = await registerMoneyAccount({
    name: "مال من",
    kind: "bank",
    assetId: fx.irt.id,
    // An opening balance provisions the tenant's own 3010 row, which the
    // protected-code assertion below needs.
    openingQty: "1000000",
    userId: fx.user.id,
  });

  await assert.rejects(
    () => previewMoneyAccountDeletion({ accountId: mine.accountId!, userId: fx.other.id }),
    /یافت نشد|متعلق به شما نیست/,
  );
  await assert.rejects(
    () => deleteMoneyAccount({ accountId: mine.accountId!, userId: fx.other.id }),
    /یافت نشد|متعلق به شما نیست/,
  );
  assert.ok((await liveAccountIds(fx.user.id)).includes(mine.accountId!));

  // 3010 «سرمایه افتتاحیه» is infrastructure the ledger resolves by code.
  const [equity] = await db
    .select()
    .from(accounts)
    .where(and(eq(accounts.code, "3010"), eq(accounts.userId, fx.user.id)));
  await assert.rejects(
    () => deleteMoneyAccount({ accountId: equity.id, userId: fx.user.id }),
    /ساختار پایه|حساب‌های دارایی/,
  );

  // A protected ASSET code (real-estate container) is refused as well.
  const [assetRow] = await db.select().from(assets).where(eq(assets.symbol, "IRT"));
  const [container] = await db
    .insert(accounts)
    .values({ userId: fx.user.id, code: "1600", name: "املاک و مستغلات", type: "asset", assetId: assetRow.id } as any)
    .returning();
  await assert.rejects(() => deleteMoneyAccount({ accountId: container.id, userId: fx.user.id }), /ساختار پایه/);
});

test("deleting twice is refused the second time", async () => {
  const fx = await setup();
  const created = await registerMoneyAccount({ name: "یک‌بار مصرف", kind: "cash", assetId: fx.irt.id, userId: fx.user.id });
  await deleteMoneyAccount({ accountId: created.accountId!, userId: fx.user.id });
  await assert.rejects(() => deleteMoneyAccount({ accountId: created.accountId!, userId: fx.user.id }), /یافت نشد/);
  const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(auditLog).where(eq(auditLog.action, "DELETE_MONEY_ACCOUNT"));
  assert.equal(row.n, 1);
});
