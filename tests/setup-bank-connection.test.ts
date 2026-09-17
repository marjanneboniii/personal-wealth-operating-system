import { normalizeBankText } from "../src/features/bankImport/parser";
import assert from "node:assert/strict";
import { test } from "node:test";
import { eq, sql } from "drizzle-orm";
import { db } from "../src/db";
import { createSchemaIfNotExists } from "../src/db/init-schema";
import { accounts, bankSmsIdentifiers, journalEntries, users } from "../src/db/schema";
import { completeSetup } from "../src/features/setup/service";
import { validateSetupBankIdentifiers } from "../src/features/setup/bankConnection";
const identifier = { accountName: "ملت جاری", bankName: "ملت", kind: "card" as const, suffix: "۱۲۳۴", ownershipConfirmed: true };
test("bank connection rejects changed account, bank, non-Toman account and absent ownership confirmation", () => {
 assert.equal(validateSetupBankIdentifiers([identifier], "ملت جاری", "بانک ملت", "IRT")[0].suffix, "1234");
 assert.throws(() => validateSetupBankIdentifiers([identifier], "حساب دیگر", "ملت", "IRT"));
 assert.throws(() => validateSetupBankIdentifiers([identifier], "ملت جاری", "ملی", "IRT"));
 assert.throws(() => validateSetupBankIdentifiers([identifier], "ملت جاری", "ملت", "USD"));
 assert.throws(() => validateSetupBankIdentifiers([{ ...identifier, ownershipConfirmed: false }], "ملت جاری", "ملت", "IRT"));
 assert.throws(() => validateSetupBankIdentifiers([{ ...identifier, suffix: "6037991234561234" }], "ملت جاری", "ملت", "IRT"));
 assert.deepEqual(validateSetupBankIdentifiers([], "حساب", "", "IRT"), []);
});
test("final setup registers bank mapping with the exact newly-created owned account and rejects mismatch before writes", async () => {
 await createSchemaIfNotExists();
 const [user] = await db.insert(users).values({ name: "Setup bank", username: "setup-bank-match", role: "user" }).returning();
 const input = { userName: "Setup bank", baseCurrency: "USD", displayCurrency: "IRT", dateCalendar: "jalali" as const, digitStyle: "fa" as const, fxRate: "100000", bankAccountName: "ملت جاری", bankName: "ملت", bankAssetSymbol: "IRT", bankOpeningBalance: "100000", bankIdentifiers: [identifier] };
 await assert.rejects(() => completeSetup({ ...input, bankAccountName: "حساب دیگر" }, user.id));
 assert.equal((await db.select().from(accounts).where(eq(accounts.userId, user.id))).length, 0);
 assert.equal((await db.select().from(journalEntries).where(eq(journalEntries.userId, user.id))).length, 0);
 await completeSetup(input, user.id);
 const [mapping] = await db.select().from(bankSmsIdentifiers).where(eq(bankSmsIdentifiers.userId, user.id));
 const [account] = await db.select().from(accounts).where(eq(accounts.id, mapping.accountId));
 assert.equal(account.code, "1010");
 assert.equal(account.name, input.bankAccountName);
 assert.equal(account.userId, user.id);
 assert.equal(mapping.bankName, "ملت");
 assert.equal(mapping.suffix, "1234");
 const before = await db.select().from(journalEntries).where(eq(journalEntries.userId, user.id));
 await assert.rejects(() => completeSetup(input, user.id), /قبلاً/);
 assert.deepEqual(await db.select().from(journalEntries).where(eq(journalEntries.userId, user.id)), before);
 assert.equal((await db.select().from(bankSmsIdentifiers).where(eq(bankSmsIdentifiers.userId, user.id))).length, 1);
});

test("multiple bank accounts keep separate balances, bank names and card mappings, including zero-balance accounts", async () => {
 await createSchemaIfNotExists();
 const [user] = await db.insert(users).values({ name: "Multiple banks", username: "setup-multiple-banks", role: "user" }).returning();
 const banks = [{ name: "ملت جاری", bankName: "ملت", balance: "100000" }, { name: "ملی پس‌انداز", bankName: "ملی ایران", balance: "200000" }, { name: "ملت دوم", bankName: "ملت", balance: "0" }];
 const input = { userName: "Multiple banks", baseCurrency: "USD", displayCurrency: "IRT", dateCalendar: "jalali" as const, digitStyle: "fa" as const, fxRate: "100000", bankAccounts: banks, bankIdentifiers: banks.slice(0, 2).map((bank) => ({ accountName: bank.name, bankName: bank.bankName, kind: "card" as const, suffix: "1234", ownershipConfirmed: true })) };
 await assert.rejects(() => completeSetup({ ...input, bankAccounts: [banks[0], { ...banks[1], name: banks[0].name }] }, user.id));
 assert.equal((await db.select().from(accounts).where(eq(accounts.userId, user.id))).length, 0);
 await assert.rejects(() => completeSetup({ ...input, bankIdentifiers: [{ ...input.bankIdentifiers[1], bankName: "ملت" }] }, user.id));
 assert.equal((await db.select().from(accounts).where(eq(accounts.userId, user.id))).length, 0);
 await completeSetup(input, user.id);
 const owned = await db.select().from(accounts).where(eq(accounts.userId, user.id));
 const bankAccounts = owned.filter((account) => ["1010", "1011", "1012"].includes(account.code));
 assert.equal(bankAccounts.length, 3);
 for (const declared of banks) {
  const account = bankAccounts.find((account) => account.name === normalizeBankText(declared.name))!;
  assert.equal(account.bankName, declared.bankName);
  const result = await db.execute(sql`select coalesce(sum(quantity),0)::text as balance from postings where account_id=${account.id}::uuid`);
  assert.equal(Number(result.rows[0].balance), Number(declared.balance));
 }
 const mappings = await db.select().from(bankSmsIdentifiers).where(eq(bankSmsIdentifiers.userId, user.id));
 assert.equal(mappings.length, 2);
 for (const mapping of mappings) assert.equal(bankAccounts.find((account) => account.id === mapping.accountId)!.bankName, mapping.bankName);
 const entries = await db.select().from(journalEntries).where(eq(journalEntries.userId, user.id));
 assert.equal(entries.length, 1);
 const balance = await db.execute(sql`select sum(base_value)::text as balance from postings where entry_id=${entries[0].id}::uuid`);
 assert.equal(Number(balance.rows[0].balance), 0);
});
