/**
 * اتصال پیامک — only Toman accounts held AT A BANK receive bank messages.
 *
 *  • the SMS page offers bank accounts only: not Toman at an exchange (بیت‌پین),
 *    not the cash box, not Tether
 *  • the server refuses a card mapped to, or a message posted from, anything else
 *  • a transfer from the bank may still land in an exchange's Toman wallet
 */
import assert from "node:assert/strict";
import { test, mock } from "node:test";
import { accounts, assetClasses, assets, users, userFxSettings, userSetupState, wallets } from "../src/db/schema";
import { todayIso } from "../src/lib/format";

let cookie: string | null = null;
mock.module("next/headers", { namedExports: { cookies: async () => ({ get: () => (cookie ? { value: cookie } : undefined), set: () => {} }), headers: async () => new Headers() } });
mock.module("next/cache", { namedExports: { revalidatePath: () => {} } });

test("SMS accounts: Toman bank accounts only; transfers may leave to an exchange", async () => {
  const { db } = await import("../src/db");
  const { createSchemaIfNotExists } = await import("../src/db/init-schema");
  const { createSession } = await import("../src/lib/auth");
  const { ensureCategoryCatalog, listCategoryTree } = await import("../src/features/categories/service");
  const { listSmsBankAccounts, listTomanAccounts } = await import("../src/features/bankImport/identifiers");
  const { addBankIdentifierAction } = await import("../src/app/actions/bankIdentifiers");
  const { confirmBankImportAction } = await import("../src/app/actions/bankImport");
  await createSchemaIfNotExists();
  await ensureCategoryCatalog();

  const [owner] = await db.insert(users).values({ name: "Owner", username: "sms-owner", role: "user" } as any).returning();
  await db.insert(userFxSettings).values({ userId: owner.id, currentRate: "100000" } as any);
  await db.insert(userSetupState).values({ userId: owner.id, completed: true, currentStep: 7 } as any);
  const [cash] = await db.insert(assetClasses).values({ code: "cash", name: "نقد و بانک" } as any).returning();
  await db.insert(assets).values({ symbol: "USD", name: "دلار", classId: cash.id, decimals: 2 } as any);
  const [irt] = await db.insert(assets).values({ symbol: "IRT", name: "تومان", classId: cash.id, decimals: 0 } as any).returning();
  const [usdt] = await db.insert(assets).values({ symbol: "USDT", name: "تتر", classId: cash.id, decimals: 6 } as any).returning();
  const wallet = async (name: string, kind: string) => (await db.insert(wallets).values({ name, kind, userId: owner.id } as any).returning())[0];
  const account = async (code: string, name: string, assetId: string, walletId: string | null) =>
    (await db.insert(accounts).values({ code, name, type: "asset", assetId, walletId, userId: owner.id } as any).returning())[0];
  const bank = await account("1010", "بانک ملت", irt.id, (await wallet("بانک ملت — جاری", "bank")).id);
  const bitpin = await account("1150", "تومان بیت‌پین", irt.id, (await wallet("بیت‌پین", "exchange")).id);
  const box = await account("1030", "نقد در دسترس", irt.id, (await wallet("گاوصندوق خانه", "cash")).id);
  await account("1100", "تتر نوبیتکس", usdt.id, (await wallet("نوبیتکس", "exchange")).id);
  await db.insert(accounts).values({ code: "5900", name: "هزینه", type: "expense", assetId: irt.id, userId: owner.id } as any);

  assert.deepEqual((await listSmsBankAccounts(owner.id)).map((a) => a.name), ["بانک ملت"], "only the bank account is offered");
  assert.deepEqual(
    (await listTomanAccounts(owner.id)).map((a) => a.name).sort(),
    [bank.name, bitpin.name, box.name].sort(),
    "every Toman account is still a valid transfer destination",
  );

  cookie = (await createSession(owner.id)).token;
  const card = (accountId: string) => addBankIdentifierAction({ accountId, bankName: "ملت", kind: "card", suffix: "1234" });
  assert.equal((await card(bitpin.id)).ok, false, "a card cannot be mapped to an exchange wallet");
  assert.equal((await card(box.id)).ok, false, "nor to the cash box");
  assert.equal((await card(bank.id)).ok, true);

  const leaf = (await listCategoryTree(owner.id)).flatMap((g: any) => g.children).find((c: any) => c.code === "FOD-GROCERY-HOME");
  const post = (fields: Record<string, string>) => {
    const fd = new FormData();
    Object.entries({ source: "برداشت 250000 تومان", type: "expense", categoryId: leaf.id, amountToman: "250000", date: todayIso(), description: "خرید", confirmed: "yes", rateConfirmed: "yes", expectedRate: "100000", ...fields }).forEach(([k, v]) => fd.set(k, v));
    return confirmBankImportAction(fd);
  };
  const fromExchange = await post({ accountId: bitpin.id });
  assert.equal(fromExchange.ok, false, "a bank message is never posted from an exchange wallet");
  assert.match(fromExchange.message, /حساب‌های بانکی تومانی/);
  // Money in the bank first (a transfer cannot overdraw it).
  const salary = (await listCategoryTree(owner.id, "income")).flatMap((g: any) => g.children).find((c: any) => c.code === "INC-SAL-NET");
  const funded = await post({ source: "واریز 1000000 تومان", type: "income", accountId: bank.id, categoryId: salary.id, amountToman: "1000000", description: "حقوق" });
  assert.equal(funded.ok, true, funded.message);
  const toExchange = await post({ source: "انتقال 250000 تومان", type: "transfer", accountId: bank.id, destinationId: bitpin.id, categoryId: "", description: "انتقال به بیت‌پین" });
  assert.equal(toExchange.ok, true, toExchange.message);
});
