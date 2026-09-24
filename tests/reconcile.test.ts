/**
 * تطبیق موجودی — the ledger against the bank's own number.
 *
 *  • the «مانده» of a bank SMS is read conservatively; Rial vs Toman is decided
 *    by the amount the user confirmed, never guessed
 *  • confirming such an SMS leaves a checkpoint; the message text is still deleted
 *  • agreement is derived: recording the missed transaction resolves it by itself
 *  • «اصلاح موجودی» posts ONE balanced adjustment against equity 3020 —
 *    never an expense — and cannot post twice or on a superseded checkpoint
 *  • a mismatch is a reminder; another tenant sees and touches nothing
 */
import assert from "node:assert/strict";
import { test, mock } from "node:test";
import { eq, sql } from "drizzle-orm";
import { accounts, assetClasses, assets, balanceCheckpoints, bankSmsConnections, bankSmsInbox, journalEntries, users, userFxSettings, userSetupState } from "../src/db/schema";
import { D } from "../src/domain/decimal";
import { todayIso } from "../src/lib/format";
import { parseBankMessage, parseReportedBalance, reportedBalanceToman } from "../src/features/bankImport/parser";

let cookie: string | null = null;
mock.module("next/headers", { namedExports: { cookies: async () => ({ get: () => (cookie ? { value: cookie } : undefined), set: () => {}, delete: () => {} }), headers: async () => new Headers() } });
mock.module("next/cache", { namedExports: { revalidatePath: () => {} } });

test("reported balance: labelled, unambiguous, unit decided by the confirmed amount", () => {
  const mellat = "بانک ملت\nبرداشت 1,000,000\nحساب:1234\nمانده:25,000,000\n0701-12:30";
  assert.deepEqual(parseReportedBalance(mellat), { value: "25000000", unit: null });
  assert.equal(reportedBalanceToman(mellat, "100000"), "2500000", "printed amount = 10× confirmed Toman → the bank wrote Rial");
  assert.equal(reportedBalanceToman(mellat, "1000000"), "25000000", "printed amount = confirmed Toman → Toman");
  assert.equal(reportedBalanceToman(mellat, "777"), null, "no decision → no checkpoint, never a tenfold guess");
  assert.equal(reportedBalanceToman("خرید 250,000 تومان موجودی: ۳۴٬۵۰۰٬۰۰۰ تومان", "250000"), "34500000", "Persian digits and an explicit unit");
  assert.equal(reportedBalanceToman("مبلغ 1,000,000 ریال مانده 5,000,000 ریال", "100000"), "500000");
  assert.equal(parseReportedBalance("برداشت 200,000 مانده قابل برداشت: 900,000"), null, "available balance is not the book balance");
  assert.equal(parseReportedBalance("واریز 10 مانده 5 مانده 6"), null, "two different balances → none");
  assert.equal(parseReportedBalance("خرید 100 تومان موجودی کافی نیست"), null);
  assert.equal(parseReportedBalance("برداشت 100 تومان مانده: -3,000 تومان")?.value, "-3000", "an overdrawn balance keeps its sign");
  // The amount parser no longer reads «قابل برداشت» as a second withdrawal.
  assert.equal(parseBankMessage("برداشت 200,000 تومان مانده قابل برداشت: 900,000 تومان").amountToman, "200000");
});

test("reconcile: SMS checkpoint, derived agreement, one equity adjustment, reminders, isolation", async () => {
  const { db } = await import("../src/db");
  const { createSchemaIfNotExists } = await import("../src/db/init-schema");
  const { createSession } = await import("../src/lib/auth");
  const { ensureCategoryCatalog, listCategoryTree } = await import("../src/features/categories/service");
  const { confirmBankImportAction } = await import("../src/app/actions/bankImport");
  const { recordBankBalanceAction, adjustToBankAction } = await import("../src/app/actions/reconcile");
  const { listReconciliation, adjustToReported } = await import("../src/features/reconcile/service");
  const { createTransactionAction } = await import("../src/app/actions");
  const { getReminders } = await import("../src/features/notifications/service");
  const { encryptSensitive } = await import("../src/lib/fieldEncryption");
  await createSchemaIfNotExists();
  await ensureCategoryCatalog();
  process.env.FIELD_ENCRYPTION_KEY ||= Buffer.alloc(32, 7).toString("base64");

  const [owner] = await db.insert(users).values({ name: "Owner", username: `rec-${Math.random().toString(36).slice(2, 8)}`, role: "user" } as any).returning();
  const [other] = await db.insert(users).values({ name: "Other", username: `rec-o-${Math.random().toString(36).slice(2, 8)}`, role: "user" } as any).returning();
  const [cash] = await db.insert(assetClasses).values({ code: "cash", name: "نقد" } as any).returning();
  await db.insert(assets).values({ symbol: "USD", name: "دلار", classId: cash.id, decimals: 2 } as any);
  const [irt] = await db.insert(assets).values({ symbol: "IRT", name: "تومان", classId: cash.id, decimals: 0 } as any).returning();
  const [bank] = await db.insert(accounts).values({ userId: owner.id, code: "1010", name: "بانک ملت", type: "asset", assetId: irt.id } as any).returning();
  const [foreign] = await db.insert(accounts).values({ userId: other.id, code: "1010", name: "حساب دیگری", type: "asset", assetId: irt.id } as any).returning();
  await db.insert(accounts).values({ userId: owner.id, code: "5900", name: "هزینه", type: "expense", assetId: irt.id } as any);
  await db.insert(accounts).values({ userId: owner.id, code: "4010", name: "درآمد", type: "income", assetId: irt.id } as any);
  await db.insert(userFxSettings).values({ userId: owner.id, currentRate: "100000" } as any);
  await db.insert(userSetupState).values({ userId: owner.id, completed: true, currentStep: 7 } as any);
  cookie = (await createSession(owner.id)).token;
  const leaf = (await listCategoryTree(owner.id)).flatMap((g) => g.children).find((c) => c.code === "FOD-GROCERY-HOME")!;
  const today = todayIso();

  // Opening money: 3,000,000 Toman.
  const seed = new FormData();
  for (const [k, v] of Object.entries({ type: "income", primaryAccountId: bank.id, nativeAmount: "3000000", irtAmount: "3000000", entryDate: today, description: "موجودی" })) seed.set(k, v);
  const incomeLeaf = (await listCategoryTree(owner.id, "income")).flatMap((g) => g.children)[0];
  seed.set("categoryId", incomeLeaf.id);
  assert.equal((await createTransactionAction(null, seed)).ok, true);

  // A bank SMS in the inbox: 500,000 Toman spent (printed in Rial), balance 2,000,000 Toman.
  // The books will say 2,500,000 — someone forgot a 500,000 withdrawal.
  const message = `بانک ملت\nبرداشت 5,000,000\nحساب:1234\nمانده:20,000,000\n${today}`;
  const [conn] = await db.insert(bankSmsConnections).values({ userId: owner.id, name: "iPhone", tokenHash: "x".repeat(64) } as any).returning();
  const sentAt = new Date();
  const [inbox] = await db
    .insert(bankSmsInbox)
    .values({ userId: owner.id, connectionId: conn.id, fingerprint: "f".repeat(64), sentAt, encryptedPayload: encryptSensitive(JSON.stringify({ message, sender: "Mellat", sentAt: sentAt.toISOString() }), `bank-sms:${owner.id}`) } as any)
    .returning();
  const fd = new FormData();
  for (const [k, v] of Object.entries({ inboxId: inbox.id, openingConfirmed: "yes", source: "client copy is not trusted", type: "expense", accountId: bank.id, categoryId: leaf.id, amountToman: "500000", date: today, description: "خرید", confirmed: "yes", rateConfirmed: "yes", expectedRate: "100000" })) fd.set(k, v);
  const confirmed = await confirmBankImportAction(fd);
  assert.equal(confirmed.ok, true, confirmed.message);
  const [row] = await db.select().from(bankSmsInbox).where(eq(bankSmsInbox.id, inbox.id));
  assert.equal(row.encryptedPayload, null, "the message text is still deleted after confirmation");
  const cps = await db.select().from(balanceCheckpoints).where(eq(balanceCheckpoints.accountId, bank.id));
  assert.equal(cps.length, 1);
  assert.equal(D(cps[0].balance).toString(), "2000000", "Rial balance stored in Toman, decided from the confirmed amount");
  assert.equal(cps[0].source, "sms");

  let [state] = await listReconciliation(owner.id);
  assert.equal(state.state, "mismatch");
  assert.equal(D(state.difference!).toString(), "-500000", "bank holds 500,000 less than the books");
  const reminder = (await getReminders(owner.id)).find((r) => r.kind === "reconcile");
  assert.ok(reminder, "a mismatch is a reminder");
  assert.equal(reminder!.amountToman, "500000");

  // Recording the missed withdrawal resolves it — nothing to keep in sync.
  const missed = new FormData();
  for (const [k, v] of Object.entries({ type: "expense", primaryAccountId: bank.id, categoryId: leaf.id, irtAmount: "500000", entryDate: today, description: "قبض جاافتاده" })) missed.set(k, v);
  assert.equal((await createTransactionAction(null, missed)).ok, true);
  [state] = await listReconciliation(owner.id);
  assert.equal(state.state, "matched");
  assert.equal((await getReminders(owner.id)).some((r) => r.kind === "reconcile"), false, "the reminder is gone by itself");
  assert.equal((await adjustToBankAction(state.checkpoint!.id)).ok, false, "nothing to adjust when the books agree");

  // A manual balance, unexplained difference → one equity adjustment.
  const manual = new FormData();
  manual.set("accountId", bank.id);
  manual.set("balance", "۲٬۱۲۰٬۰۰۰");
  manual.set("asOf", today);
  assert.equal((await recordBankBalanceAction(null, manual)).ok, true);
  [state] = await listReconciliation(owner.id);
  assert.equal(state.state, "mismatch");
  assert.equal(D(state.difference!).toString(), "120000");
  const before = (await db.select().from(journalEntries)).length;
  const [adj1, adj2] = await Promise.allSettled([adjustToReported(owner.id, state.checkpoint!.id), adjustToReported(owner.id, state.checkpoint!.id)]);
  assert.equal([adj1, adj2].filter((r) => r.status === "fulfilled").length, 1, "a double tap posts once");
  assert.equal((await db.select().from(journalEntries)).length, before + 1);
  const entryId = (adj1.status === "fulfilled" ? adj1.value : (adj2 as PromiseFulfilledResult<{ entryId: string }>).value).entryId;
  const legs = (await db.execute(sql`
    select a.code, a.type, p.quantity::text as q, p.base_value::text as b from postings p join accounts a on a.id = p.account_id where p.entry_id = ${entryId}::uuid order by a.code
  `)).rows as { code: string; type: string; q: string; b: string }[];
  assert.deepEqual(legs.map((l) => [l.code, l.type]), [["1010", "asset"], ["3020", "equity"]], "never an income or expense leg");
  assert.equal(D(legs[0].q).toString(), "120000");
  assert.equal(D(legs[0].b).add(legs[1].b).toString(), "0", "balanced");
  const [je] = await db.select().from(journalEntries).where(eq(journalEntries.id, entryId));
  assert.equal(je.type, "adjustment");
  const snap = await db.execute(sql`select irt_amount::text as t from entry_fx_snapshots where entry_id = ${entryId}::uuid`);
  assert.equal(D(snap.rows[0].t as string).toString(), "120000", "the Toman figure is frozen like every entry");
  [state] = await listReconciliation(owner.id);
  assert.equal(state.state, "matched");

  // Isolation: another tenant can neither record against, nor adjust, the owner's account.
  cookie = (await createSession(other.id)).token;
  const foreignTry = new FormData();
  foreignTry.set("accountId", bank.id);
  foreignTry.set("balance", "1");
  assert.equal((await recordBankBalanceAction(null, foreignTry)).ok, false);
  assert.equal((await adjustToBankAction(state.checkpoint!.id)).ok, false);
  assert.deepEqual(await listReconciliation(other.id).then((l) => l.map((r) => r.accountId)), [foreign.id]);
});
