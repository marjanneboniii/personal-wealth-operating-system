/**
 * انتقال تومان — بانک ⇄ تومانِ کارگزاری و تومانِ صرافی، end to end through
 * `createTransactionAction`, the way the transfer form posts it.
 */
import assert from "node:assert/strict";
import { test, mock } from "node:test";
import { sql } from "drizzle-orm";
import { D } from "../src/domain/decimal";
import { accounts, assetClasses, assets, users, userFxSettings } from "../src/db/schema";

const cookieJar: { value: string | null } = { value: null };
mock.module("next/headers", {
  namedExports: {
    cookies: async () => ({
      get: (name: string) => (name === "pwos_session" && cookieJar.value ? { value: cookieJar.value } : undefined),
      set: () => {},
      delete: () => {},
    }),
    headers: async () => new Headers(),
  },
});
mock.module("next/cache", { namedExports: { revalidatePath: () => {} } });

let db: any, createSchemaIfNotExists: any, createSession: any, createTransactionAction: any;
let postEntry: any, getAccountBalances: any;

const modulesReady = (async () => {
  ({ db } = await import("../src/db"));
  ({ createSchemaIfNotExists } = await import("../src/db/init-schema"));
  ({ createSession } = await import("../src/lib/auth"));
  ({ createTransactionAction } = await import("../src/app/actions"));
  ({ postEntry } = await import("../src/features/ledger/service"));
  ({ getAccountBalances } = await import("../src/features/ledger/queries"));
})();

const TODAY = "2026-09-15";

function transferForm(fields: Record<string, string>) {
  const fd = new FormData();
  fd.set("type", "transfer");
  fd.set("entryDate", TODAY);
  fd.set("fee", "");
  fd.set("feeMode", "native");
  fd.set("quantity", "");
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

async function fixture() {
  await createSchemaIfNotExists();
  await db.execute(sql`truncate journal_entries, lots, accounts, assets, asset_classes, user_fx_settings restart identity cascade`);
  const [user] = await db
    .insert(users)
    .values({ name: "Mover", username: `mover-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, role: "owner" } as any)
    .returning();
  await db.insert(userFxSettings).values({ userId: user.id, currentRate: "100000" } as any);
  const [cash] = await db.insert(assetClasses).values({ code: "cash", name: "نقد و بانک" } as any).returning();
  const [irt] = await db.insert(assets).values({ symbol: "IRT", name: "تومان", classId: cash.id, decimals: 0 } as any).returning();

  const { wallets } = await import("../src/db/schema");
  const place = async (name: string, kind: string) =>
    (await db.insert(wallets).values({ userId: user.id, name, kind } as any).returning())[0];
  const melli = await place("بانک ملی", "bank");
  const mofid = await place("کارگزاری مفید", "broker");
  const nobitex = await place("نوبیتکس", "exchange");
  const account = async (code: string, name: string, type: string, walletId: string | null = null) =>
    (await db.insert(accounts).values({ code, name, type, assetId: irt.id, walletId, userId: user.id } as any).returning())[0];
  const bank = await account("1010", "بانک ملی", "asset", melli.id);
  const broker = await account("1500", "تومان - کارگزاری مفید", "asset", mofid.id);
  const exchange = await account("1501", "تومان - نوبیتکس", "asset", nobitex.id);
  const equity = await account("3010", "سرمایه افتتاحیه", "equity");

  await postEntry({
    entryDate: TODAY,
    type: "opening",
    description: "افتتاحیه",
    userId: user.id,
    postings: [
      { accountId: bank.id, assetId: irt.id, quantity: "50000000", baseValue: "500" },
      { accountId: broker.id, assetId: irt.id, quantity: "30000000", baseValue: "300" },
      { accountId: equity.id, assetId: irt.id, quantity: "-80000000", baseValue: "-800" },
    ],
  });
  const { token } = await createSession(user.id);
  cookieJar.value = token;
  return { user, bank, broker, exchange };
}

const qtyOf = async (userId: string, accountId: string) =>
  D((await getAccountBalances(userId)).find((b: any) => b.accountId === accountId)?.quantity ?? "0").toString();

test("Toman moves bank → brokerage, brokerage → bank and brokerage → exchange", async () => {
  await modulesReady;
  const f = await fixture();

  const toBroker = await createTransactionAction(
    null,
    transferForm({ description: "انتقال", primaryAccountId: f.bank.id, counterAccountId: f.broker.id, irtAmount: "10000000" }),
  );
  assert.equal(toBroker.ok, true, toBroker.message);
  assert.equal(await qtyOf(f.user.id, f.bank.id), "40000000");
  assert.equal(await qtyOf(f.user.id, f.broker.id), "40000000");

  const toBank = await createTransactionAction(
    null,
    transferForm({ description: "انتقال", primaryAccountId: f.broker.id, counterAccountId: f.bank.id, irtAmount: "40000000" }),
  );
  assert.equal(toBank.ok, true, toBank.message);
  assert.equal(await qtyOf(f.user.id, f.broker.id), "0");
  assert.equal(await qtyOf(f.user.id, f.bank.id), "80000000");

  const toExchange = await createTransactionAction(
    null,
    transferForm({ description: "انتقال", primaryAccountId: f.bank.id, counterAccountId: f.exchange.id, irtAmount: "5000000" }),
  );
  assert.equal(toExchange.ok, true, toExchange.message);
});

test("«همه» moves the whole balance when it was opened at the same non-round rate", async () => {
  await modulesReady;
  const f = await fixture();
  const rate = "1023457";
  await db.execute(sql`update user_fx_settings set current_rate = ${rate} where user_id = ${f.user.id}`);
  // A fresh brokerage balance booked at today's rate, exactly as the setup wizard does.
  const [irtRow] = await db.execute(sql`select asset_id from accounts where id = ${f.broker.id}`).then((r: any) => r.rows);
  const [equityRow] = (await db.execute(sql`select id from accounts where code = '3010' and user_id = ${f.user.id}`)).rows;
  const base = D("7777777").div(rate).toString();
  await postEntry({
    entryDate: TODAY,
    type: "opening",
    description: "افتتاحیه",
    userId: f.user.id,
    postings: [
      { accountId: f.exchange.id, assetId: irtRow.asset_id, quantity: "7777777", baseValue: base },
      { accountId: equityRow.id, assetId: irtRow.asset_id, quantity: "-7777777", baseValue: D(base).neg().toString() },
    ],
  });

  const all = await createTransactionAction(
    null,
    transferForm({ description: "انتقال", primaryAccountId: f.exchange.id, counterAccountId: f.broker.id, irtAmount: "7777777" }),
  );
  assert.equal(all.ok, true, all.message);
  assert.equal(await qtyOf(f.user.id, f.exchange.id), "0");
});

test("«+ افزودن» creates the same coin at another place with a zero balance, and USDC then moves there", async () => {
  await modulesReady;
  const f = await fixture();
  const { createTransferDestinationAction } = await import("../src/app/actions");
  const { wallets } = await import("../src/db/schema");
  const [stable] = await db.insert(assetClasses).values({ code: "stable", name: "استیبل‌کوین" } as any).returning();
  const [usdc] = await db.insert(assets).values({ symbol: "USDC", name: "USD Coin", classId: stable.id, decimals: 6 } as any).returning();
  const [btc] = await db.insert(assets).values({ symbol: "BTC", name: "Bitcoin", classId: stable.id, decimals: 8 } as any).returning();
  const [rabby] = await db.insert(wallets).values({ userId: f.user.id, name: "ربی والت", kind: "hot" } as any).returning();
  const [binance] = await db.insert(wallets).values({ userId: f.user.id, name: "بایننس", kind: "exchange" } as any).returning();
  const [usdcRabby] = await db
    .insert(accounts)
    .values({ code: "1210", name: "یو اس دی سی - ربی والت", type: "asset", assetId: usdc.id, walletId: rabby.id, userId: f.user.id } as any)
    .returning();
  const [btcBinance] = await db
    .insert(accounts)
    .values({ code: "1211", name: "بیت‌کوین - بایننس", type: "asset", assetId: btc.id, walletId: binance.id, userId: f.user.id } as any)
    .returning();
  const [equity] = (await db.execute(sql`select id from accounts where code = '3010' and user_id = ${f.user.id}`)).rows;
  await postEntry({
    entryDate: TODAY,
    type: "opening",
    description: "افتتاحیه",
    userId: f.user.id,
    postings: [
      { accountId: usdcRabby.id, assetId: usdc.id, quantity: "250", baseValue: "250" },
      { accountId: equity.id, assetId: usdc.id, quantity: "-250", baseValue: "-250" },
    ],
  });

  const added = await createTransferDestinationAction({ sourceAccountId: usdcRabby.id, placeName: "متامسک" });
  assert.equal(added.ok, true, added.message);
  assert.equal(added.account?.name, "یو اس دی سی - متامسک");
  assert.equal(added.account?.symbol, "USDC");
  assert.equal(await qtyOf(f.user.id, added.account!.id), "0", "a new destination starts empty");

  const again = await createTransferDestinationAction({ sourceAccountId: usdcRabby.id, placeName: "metamask" });
  assert.equal(again.account?.id, added.account?.id, "the same place is never a second account");

  assert.equal((await createTransferDestinationAction({ sourceAccountId: usdcRabby.id, placeName: "ربی والت" })).ok, false);
  assert.equal((await createTransferDestinationAction({ sourceAccountId: usdcRabby.id, placeName: "کارگزاری مفید" })).ok, false);
  assert.equal((await createTransferDestinationAction({ sourceAccountId: btcBinance.id, placeName: "ربی والت" })).ok, false, "no Bitcoin to Rabby");
  assert.equal((await createTransferDestinationAction({ sourceAccountId: f.broker.id, placeName: "بایننس" })).ok, false, "no Toman abroad");
  assert.equal((await createTransferDestinationAction({ sourceAccountId: f.broker.id, placeName: "والکس" })).ok, true);

  const moved = await createTransactionAction(
    null,
    transferForm({
      description: "انتقال",
      primaryAccountId: usdcRabby.id,
      counterAccountId: added.account!.id,
      quantity: "250",
      irtAmount: "25000000",
    }),
  );
  assert.equal(moved.ok, true, moved.message);
  assert.equal(await qtyOf(f.user.id, usdcRabby.id), "0", "the emptied account stays, at zero");
  assert.equal(await qtyOf(f.user.id, added.account!.id), "250");
});

test("the whole balance moves at a real rate, from a setup bank account with no wallet", async () => {
  await modulesReady;
  const f = await fixture();
  // A real rate: 1 / rate does not terminate, so the dollar value is rounded.
  await db.execute(sql`update user_fx_settings set current_rate = '1023457' where user_id = ${f.user.id}`);
  // The setup wizard's bank: code 1010, no wallet, named by the user.
  await db.execute(sql`update accounts set wallet_id = null, name = 'ملت' where id = ${f.bank.id}`);

  const all = await createTransactionAction(
    null,
    transferForm({ description: "انتقال", primaryAccountId: f.broker.id, counterAccountId: f.bank.id, irtAmount: "30000000" }),
  );
  assert.equal(all.ok, true, all.message);
  assert.equal(await qtyOf(f.user.id, f.broker.id), "0");

  const back = await createTransactionAction(
    null,
    transferForm({ description: "انتقال", primaryAccountId: f.bank.id, counterAccountId: f.broker.id, irtAmount: "80000000" }),
  );
  assert.equal(back.ok, true, back.message);
  assert.equal(await qtyOf(f.user.id, f.bank.id), "0");
  assert.equal(await qtyOf(f.user.id, f.broker.id), "80000000");
});
