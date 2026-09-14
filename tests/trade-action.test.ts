/**
 * خرید و فروش دارایی — end to end through `createTransactionAction`.
 *
 *   ۱. Toman → 1 000 USDT (a swap, no FIFO lot)
 *   ۲. 600 USDT → 0.2 ETH at a limit price: USDT falls by EXACTLY 600, ETH rises
 *   ۳. a gold fund cannot be bought with USDT — Toman only
 *   ۴. a position (the gold fund) is never a payment account
 *   ۵. a sale larger than the holding is refused
 *   ۶. 0.1 ETH → 320 USDT
 * and every trade's quantity, Toman and Tether unit price and Tether rate are
 * frozen on the entry for the history view.
 */
import assert from "node:assert/strict";
import { test, mock } from "node:test";
import { eq, sql } from "drizzle-orm";
import { D } from "../src/domain/decimal";
import {
  accounts,
  assetClasses,
  assets,
  entryFxSnapshots,
  journalEntries,
  users,
  userFxSettings,
  wallexAssetCatalog,
} from "../src/db/schema";

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
let postEntry: any, getAccountBalances: any, getEntryFxSnapshots: any, TOMAN_ONLY_MESSAGE: string;

const modulesReady = (async () => {
  ({ db } = await import("../src/db"));
  ({ createSchemaIfNotExists } = await import("../src/db/init-schema"));
  ({ createSession } = await import("../src/lib/auth"));
  ({ createTransactionAction } = await import("../src/app/actions"));
  ({ postEntry } = await import("../src/features/ledger/service"));
  ({ getAccountBalances } = await import("../src/features/ledger/queries"));
  ({ getEntryFxSnapshots } = await import("../src/features/ledger/fxSnapshots"));
  ({ TOMAN_ONLY_MESSAGE } = await import("../src/features/trade/rules"));
})();

const TODAY = "2026-09-14";

function tradeForm(fields: Record<string, string>) {
  const fd = new FormData();
  fd.set("entryDate", TODAY);
  fd.set("fee", "");
  fd.set("feeMode", "irt");
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

async function fixture() {
  await createSchemaIfNotExists();
  // `users` is not truncated: TRUNCATE … CASCADE would also empty the vehicle
  // catalogue (vehicle_catalog.created_by_user_id → users). Each test gets a new user instead.
  await db.execute(sql`truncate journal_entries, lots, accounts, assets, asset_classes, user_fx_settings, wallex_asset_catalog restart identity cascade`);

  const [user] = await db
    .insert(users)
    .values({ name: "Trader", username: `trader-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, role: "owner" } as any)
    .returning();
  await db.insert(userFxSettings).values({ userId: user.id, currentRate: "100000" } as any);
  // Toman per Tether on the market — deliberately different from the dollar rate.
  await db.insert(wallexAssetCatalog).values({ symbol: "USDT", displayName: "تتر", latinName: "Tether", kind: "stablecoin", priceTmn: "105000", priceUsdt: "1" } as any);

  const cls = async (code: string, name: string) =>
    (await db.insert(assetClasses).values({ code, name } as any).returning())[0];
  const [cash, stable, crypto, fund, equity] = [
    await cls("cash", "نقد و بانک"),
    await cls("stable", "استیبل‌کوین"),
    await cls("crypto", "رمزارز"),
    await cls("fund", "صندوق سرمایه‌گذاری"),
    await cls("equity_open", "حقوق صاحبان سهام"),
  ];
  const asset = async (symbol: string, classId: string, decimals = 8) =>
    (await db.insert(assets).values({ symbol, name: symbol, classId, decimals } as any).returning())[0];
  const irt = await asset("IRT", cash.id, 0);
  const usdt = await asset("USDT", stable.id, 6);
  const eth = await asset("ETH", crypto.id);
  const goldFund = await asset("GOLDFUND", fund.id, 0);
  void equity;

  const account = async (code: string, name: string, type: string, assetId: string) =>
    (await db.insert(accounts).values({ code, name, type, assetId, userId: user.id } as any).returning())[0];
  const bank = await account("1010", "بانک", "asset", irt.id);
  const cashBox = await account("1020", "صندوق خانگی", "asset", irt.id);
  const usdtWallet = await account("1110", "کیف تتر", "asset", usdt.id);
  const ethAccount = await account("1210", "اتریوم", "asset", eth.id);
  const fundAccount = await account("1310", "صندوق طلا", "asset", goldFund.id);
  const openingEquity = await account("3010", "سرمایه افتتاحیه", "equity", irt.id);

  // 200 000 000 Toman in the bank to start with.
  await postEntry({
    entryDate: TODAY,
    type: "opening",
    description: "افتتاحیه",
    userId: user.id,
    postings: [
      { accountId: bank.id, assetId: irt.id, quantity: "200000000", baseValue: "2000" },
      { accountId: openingEquity.id, assetId: irt.id, quantity: "-200000000", baseValue: "-2000" },
    ],
  });

  const { token } = await createSession(user.id);
  cookieJar.value = token;
  return { user, bank, cashBox, usdtWallet, ethAccount, fundAccount };
}

const qtyOf = async (userId: string, accountId: string) =>
  D((await getAccountBalances(userId)).find((b: any) => b.accountId === accountId)?.quantity ?? "0");

const lastEntry = async () =>
  (await db.select().from(journalEntries).orderBy(sql`created_at desc`).limit(1))[0];

test("buy, swap and sell settle in the exact units typed, and freeze both prices", async () => {
  await modulesReady;
  const f = await fixture();

  // ۱. 1 000 USDT for 105 000 000 Toman — a conversion, not a FIFO trade.
  const swap = await createTransactionAction(
    null,
    tradeForm({
      type: "buy",
      description: "خرید تتر",
      primaryAccountId: f.usdtWallet.id,
      counterAccountId: f.bank.id,
      quantity: "1000",
      unitPrice: "105000",
      settleQuantity: "105000000",
      irtAmount: "105000000",
      priceMode: "market",
    }),
  );
  assert.equal(swap.ok, true, swap.message);
  const swapEntry = await lastEntry();
  assert.equal(swapEntry.type, "fx", "a stablecoin purchase is booked as a swap");
  assert.equal((await qtyOf(f.user.id, f.usdtWallet.id)).toString(), "1000");
  assert.equal((await qtyOf(f.user.id, f.bank.id)).toString(), "95000000");

  // ۲. 0.2 ETH at a limit price of 3 000 USDT: exactly 600 USDT leaves the wallet.
  const buy = await createTransactionAction(
    null,
    tradeForm({
      type: "buy",
      description: "خرید اتریوم",
      primaryAccountId: f.ethAccount.id,
      counterAccountId: f.usdtWallet.id,
      quantity: "0.2",
      unitPrice: "3000",
      settleQuantity: "600",
      irtAmount: "63000000",
      priceMode: "limit",
    }),
  );
  assert.equal(buy.ok, true, buy.message);
  const buyEntry = await lastEntry();
  assert.equal(buyEntry.type, "buy");
  assert.equal((await qtyOf(f.user.id, f.usdtWallet.id)).toString(), "400", "the stablecoin falls by exactly 600");
  assert.equal((await qtyOf(f.user.id, f.ethAccount.id)).toString(), "0.2", "the coin rises by exactly 0.2");

  const frozen = (await getEntryFxSnapshots([buyEntry.id])).get(buyEntry.id)!;
  assert.ok(frozen.trade, "the trade is frozen for the history view");
  assert.equal(frozen.trade.tradeSymbol, "ETH");
  assert.equal(D(frozen.trade.tradeQuantity).toString(), "0.2");
  assert.equal(frozen.trade.settleSymbol, "USDT");
  assert.equal(D(frozen.trade.settleQuantity!).toString(), "600");
  assert.equal(D(frozen.trade.unitPriceUsdt!).toString(), "3000");
  assert.equal(D(frozen.trade.unitPriceIrt!).toString(), "315000000", "3 000 USDT × 105 000 Toman");
  assert.equal(D(frozen.trade.usdtRateIrt!).toString(), "105000");
  assert.equal(frozen.trade.priceMode, "limit");
  assert.equal(D(frozen.irtAmount).toFixed(0), "63000000");

  const entriesBefore = (await db.select().from(journalEntries)).length;

  // ۳. A gold fund is Toman-only.
  const fundWithUsdt = await createTransactionAction(
    null,
    tradeForm({
      type: "buy",
      description: "خرید صندوق طلا",
      primaryAccountId: f.fundAccount.id,
      counterAccountId: f.usdtWallet.id,
      quantity: "10",
      unitPrice: "10",
      settleQuantity: "100",
      irtAmount: "10500000",
    }),
  );
  assert.equal(fundWithUsdt.ok, false);
  assert.equal(fundWithUsdt.message, TOMAN_ONLY_MESSAGE);

  // …and through a bank, not a Toman cash box.
  const fundWithCashBox = await createTransactionAction(
    null,
    tradeForm({
      type: "buy",
      description: "خرید صندوق طلا",
      primaryAccountId: f.fundAccount.id,
      counterAccountId: f.cashBox.id,
      quantity: "10",
      unitPrice: "100000",
      settleQuantity: "1000000",
      irtAmount: "1000000",
    }),
  );
  assert.equal(fundWithCashBox.ok, false);
  assert.equal(fundWithCashBox.message, TOMAN_ONLY_MESSAGE);

  // ۴. A position never pays for another purchase.
  const payWithPosition = await createTransactionAction(
    null,
    tradeForm({
      type: "buy",
      description: "خرید اتریوم با صندوق",
      primaryAccountId: f.ethAccount.id,
      counterAccountId: f.fundAccount.id,
      quantity: "0.1",
      unitPrice: "1",
      settleQuantity: "1",
      irtAmount: "100000",
    }),
  );
  assert.equal(payWithPosition.ok, false);
  assert.match(payWithPosition.message, /حساب تومانی یا کیف پول استیبل‌کوین/);

  // ۵. Not more than is held.
  const oversell = await createTransactionAction(
    null,
    tradeForm({
      type: "sell",
      description: "فروش اتریوم",
      primaryAccountId: f.ethAccount.id,
      counterAccountId: f.usdtWallet.id,
      quantity: "1",
      unitPrice: "3000",
      settleQuantity: "3000",
      irtAmount: "315000000",
    }),
  );
  assert.equal(oversell.ok, false);
  assert.match(oversell.message, /بیشتر است/);
  assert.equal((await db.select().from(journalEntries)).length, entriesBefore, "refused trades write nothing");

  // ۶. 0.1 ETH → 320 USDT.
  const sell = await createTransactionAction(
    null,
    tradeForm({
      type: "sell",
      description: "فروش اتریوم",
      primaryAccountId: f.ethAccount.id,
      counterAccountId: f.usdtWallet.id,
      quantity: "0.1",
      unitPrice: "3200",
      settleQuantity: "320",
      irtAmount: "33600000",
      priceMode: "market",
    }),
  );
  assert.equal(sell.ok, true, sell.message);
  assert.equal((await qtyOf(f.user.id, f.usdtWallet.id)).toString(), "720");
  assert.equal((await qtyOf(f.user.id, f.ethAccount.id)).toString(), "0.1");

  const [sellSnap] = await db.select().from(entryFxSnapshots).where(eq(entryFxSnapshots.entryId, (await lastEntry()).id));
  assert.equal(D(sellSnap.unitPriceUsdt).toString(), "3200");
  assert.equal(sellSnap.priceMode, "market");
});

test("a coin bought at a place is held there, and each place trades only what it supports", async () => {
  await modulesReady;
  const f = await fixture();
  const { wallets, accounts: accountsTable, assets: assetsTable, assetClasses: classes } = await import("../src/db/schema");

  const wallet = async (name: string, kind: string) =>
    (await db.insert(wallets).values({ userId: f.user.id, name, kind } as any).returning())[0];
  const bitpin = await wallet("بیت‌پین", "exchange");
  const rabby = await wallet("ربی والت", "hot");

  const [crypto] = await db.select().from(classes).where(eq(classes.code, "crypto"));
  const [stable] = await db.select().from(classes).where(eq(classes.code, "stable"));
  const [btc] = await db.insert(assetsTable).values({ symbol: "BTC", name: "بیت‌کوین", classId: crypto.id, decimals: 8 } as any).returning();
  const [usde] = await db.insert(assetsTable).values({ symbol: "USDE", name: "اتنا یو‌اس‌دی‌ای", classId: stable.id, decimals: 6 } as any).returning();
  const [usdc] = await db.insert(assetsTable).values({ symbol: "USDC", name: "یو‌اس‌دی‌سی", classId: stable.id, decimals: 6 } as any).returning();
  const [eth] = await db.select().from(assetsTable).where(eq(assetsTable.symbol, "ETH"));

  const account = async (code: string, name: string, assetId: string, walletId: string | null) =>
    (await db.insert(accountsTable).values({ code, name, type: "asset", assetId, walletId, userId: f.user.id } as any).returning())[0];
  const btcPicked = await account("WLX-BTC", "بیت‌کوین (BTC)", btc.id, null);
  const usdeRabby = await account("H-USDE-R", "اتنا یو‌اس‌دی‌ای - ربی والت", usde.id, rabby.id);
  const usdcBitpin = await account("H-USDC-B", "یو‌اس‌دی‌سی - بیت‌پین", usdc.id, bitpin.id);
  const btcRabby = await account("H-BTC-R", "بیت‌کوین - ربی والت", btc.id, rabby.id);

  // 500 USDe in Rabby, 300 USDC at Bitpin.
  const [equity] = await db.select().from(accountsTable).where(eq(accountsTable.code, "3010"));
  await postEntry({
    entryDate: TODAY,
    type: "opening",
    description: "موجودی استیبل‌کوین",
    userId: f.user.id,
    postings: [
      { accountId: usdeRabby.id, assetId: usde.id, quantity: "500", baseValue: "500" },
      { accountId: usdcBitpin.id, assetId: usdc.id, quantity: "300", baseValue: "300" },
      { accountId: equity.id, assetId: equity.assetId, quantity: "-80000000", baseValue: "-800" },
    ],
  });

  // Toman from the bank, bought at Bitpin → the coin is held in «بیت‌کوین - بیت‌پین».
  const btcWithToman = await createTransactionAction(
    null,
    tradeForm({
      type: "buy",
      description: "خرید بیت‌کوین",
      primaryAccountId: btcPicked.id,
      counterAccountId: f.bank.id,
      quantity: "0.01",
      unitPrice: "10000000000",
      settleQuantity: "100000000",
      irtAmount: "100000000",
      placeName: "بیت‌پین",
    }),
  );
  assert.equal(btcWithToman.ok, true, btcWithToman.message);
  const [btcAtBitpin] = await db
    .select()
    .from(accountsTable)
    .where(sql`${accountsTable.assetId} = ${btc.id} and ${accountsTable.walletId} = ${bitpin.id}`);
  assert.ok(btcAtBitpin, "an account at Bitpin was opened for the coin");
  assert.equal(btcAtBitpin.name, "بیت‌کوین - بیت‌پین");
  assert.equal((await qtyOf(f.user.id, btcAtBitpin.id)).toString(), "0.01");
  assert.equal((await qtyOf(f.user.id, btcPicked.id)).toString(), "0", "the place-less pick holds nothing");

  const refusedBuy = async (fields: Record<string, string>) => {
    const res = await createTransactionAction(null, tradeForm({ type: "buy", description: "خرید", ...fields }));
    assert.equal(res.ok, false, `expected a refusal for ${JSON.stringify(fields)}`);
    return res.message;
  };

  // Rabby is EVM-only: no Bitcoin.
  assert.match(
    await refusedBuy({ primaryAccountId: btcPicked.id, counterAccountId: usdeRabby.id, quantity: "0.001", unitPrice: "100000", settleQuantity: "100", irtAmount: "10500000" }),
    /شبکه/,
  );
  // Bitpin does not trade USDC.
  assert.match(
    await refusedBuy({ primaryAccountId: f.ethAccount.id, counterAccountId: usdcBitpin.id, quantity: "0.01", unitPrice: "3000", settleQuantity: "30", irtAmount: "3150000" }),
    /تومان یا تتر/,
  );

  // Ethereum swapped with USDe inside Rabby — held in Rabby.
  const ethInRabby = await createTransactionAction(
    null,
    tradeForm({
      type: "buy",
      description: "سواپ اتریوم",
      primaryAccountId: f.ethAccount.id,
      counterAccountId: usdeRabby.id,
      quantity: "0.1",
      unitPrice: "3000",
      settleQuantity: "300",
      irtAmount: "31500000",
    }),
  );
  assert.equal(ethInRabby.ok, true, ethInRabby.message);
  assert.equal((await qtyOf(f.user.id, usdeRabby.id)).toString(), "200");
  const [ethAtRabby] = await db
    .select()
    .from(accountsTable)
    .where(sql`${accountsTable.assetId} = ${eth.id} and ${accountsTable.walletId} = ${rabby.id}`);
  assert.equal((await qtyOf(f.user.id, ethAtRabby.id)).toString(), "0.1");

  // Bitcoin cannot be sent to Rabby.
  const sendBtc = await createTransactionAction(
    null,
    tradeForm({
      type: "transfer",
      description: "انتقال بیت‌کوین",
      primaryAccountId: btcAtBitpin.id,
      counterAccountId: btcRabby.id,
      quantity: "0.005",
      irtAmount: "50000000",
    }),
  );
  assert.equal(sendBtc.ok, false);
  assert.match(sendBtc.message, /شبکه/);
});

test("a vehicle bought now is paid from a Toman bank account — never a cash box, never beyond the balance", async () => {
  await modulesReady;
  const f = await fixture();
  const { ensureVehicleModuleReady, createUserVehicle } = await import("../src/features/rwa/vehicle/service");
  const { listVehicleCatalogModels, seedVehicleCatalogIfEmpty } = await import("../src/features/rwa/vehicle/catalog");
  await ensureVehicleModuleReady();
  // The fixture's TRUNCATE … CASCADE clears the catalogue; the module bootstrap is memoised.
  await seedVehicleCatalogIfEmpty();
  const [model] = await listVehicleCatalogModels();
  const buy = (paymentAccountId: string, purchasePriceToman: string) =>
    createUserVehicle({
      userId: f.user.id,
      catalogId: model.id,
      manufacturingYear: 1402,
      ownershipDate: TODAY,
      purchasePriceToman,
      purchaseUsdRate: "100000",
      paymentAccountId,
    });

  await assert.rejects(() => buy(f.cashBox.id, "10000000"), /حساب بانکی تومانی/);

  await buy(f.bank.id, "150000000");
  assert.equal((await qtyOf(f.user.id, f.bank.id)).toString(), "50000000", "the price left the bank in Toman");
  const entry = await lastEntry();
  assert.equal(entry.type, "buy");
  const frozen = (await getEntryFxSnapshots([entry.id])).get(entry.id)!;
  assert.equal(frozen.trade?.tradeSymbol, "خودرو ۱");
  assert.equal(D(frozen.trade!.settleQuantity!).toFixed(0), "150000000");

  await assert.rejects(() => buy(f.bank.id, "100000000"), /موجودی حساب کافی نیست/);
  assert.equal((await qtyOf(f.user.id, f.bank.id)).toString(), "50000000", "a refused purchase moves nothing");
});

test("a vehicle bought from a bank counts ONCE in net worth, at its latest valuation", async () => {
  await modulesReady;
  const f = await fixture();
  const { ensureVehicleModuleReady, createUserVehicle } = await import("../src/features/rwa/vehicle/service");
  const { listVehicleCatalogModels, seedVehicleCatalogIfEmpty } = await import("../src/features/rwa/vehicle/catalog");
  const { recordVehicleValuationSnapshot } = await import("../src/features/rwa/vehicle/valuation");
  const { getPortfolioValuation } = await import("../src/features/portfolio/service");
  await ensureVehicleModuleReady();
  await seedVehicleCatalogIfEmpty();
  const [model] = await listVehicleCatalogModels();

  const before = await getPortfolioValuation(TODAY, f.user.id);
  const car = await createUserVehicle({
    userId: f.user.id,
    catalogId: model.id,
    manufacturingYear: 1402,
    ownershipDate: TODAY,
    purchasePriceToman: "150000000",
    purchaseUsdRate: "100000",
    paymentAccountId: f.bank.id,
  });

  const afterBuy = await getPortfolioValuation(TODAY, f.user.id);
  const carRows = afterBuy.assetValuations.filter((row: any) => row.assetId === car.assetId);
  assert.equal(carRows.length, 1, "the car appears once — ledger holding and registry are not both counted");
  assert.equal(carRows[0].currentValueToman, "150000000");
  assert.ok(
    D(afterBuy.totalNetWorthToman).sub(before.totalNetWorthToman).abs().lt("2"),
    `buying with money you had does not change net worth (${before.totalNetWorthToman} → ${afterBuy.totalNetWorthToman})`,
  );

  await recordVehicleValuationSnapshot({
    catalogId: model.id,
    userVehicleId: car.id,
    snapshotDate: TODAY,
    currentValueToman: "180000000",
    usdRate: "100000",
    source: "manual",
    createdByUserId: f.user.id,
  });
  const afterRevalue = await getPortfolioValuation(TODAY, f.user.id);
  const revalued = afterRevalue.assetValuations.filter((row: any) => row.assetId === car.assetId);
  assert.equal(revalued.length, 1);
  assert.equal(revalued[0].currentValueToman, "180000000", "the latest valuation, not the purchase price");
  assert.ok(
    D(afterRevalue.totalNetWorthToman).sub(afterBuy.totalNetWorthToman).sub("30000000").abs().lt("2"),
    "net worth rises by exactly the revaluation",
  );
});

test("a vehicle is sold from «فروش دارایی» in Toman, into a bank account only", async () => {
  await modulesReady;
  const f = await fixture();
  const { ensureVehicleModuleReady, createUserVehicle } = await import("../src/features/rwa/vehicle/service");
  const { listVehicleCatalogModels, seedVehicleCatalogIfEmpty } = await import("../src/features/rwa/vehicle/catalog");
  const { vehicleAssets } = await import("../src/db/schema");
  await ensureVehicleModuleReady();
  await seedVehicleCatalogIfEmpty();
  const [model] = await listVehicleCatalogModels();
  const car = await createUserVehicle({
    userId: f.user.id,
    catalogId: model.id,
    manufacturingYear: 1400,
    ownershipDate: "2024-06-01",
    purchasePriceToman: "800000000",
  });

  const saleForm = (counterAccountId: string) =>
    tradeForm({
      type: "sell",
      description: "فروش خودرو",
      registryKind: "vehicle",
      registryId: car.id,
      counterAccountId,
      irtAmount: "900000000",
      settleQuantity: "900000000",
    });

  for (const notABank of [f.usdtWallet.id, f.cashBox.id]) {
    const refused = await createTransactionAction(null, saleForm(notABank));
    assert.equal(refused.ok, false);
    assert.match(refused.message, /حساب بانکی تومانی/);
  }
  const [stillOwned] = await db.select().from(vehicleAssets).where(eq(vehicleAssets.id, car.id));
  assert.equal(stillOwned.status, "active", "a refused sale changes nothing");

  const bankBefore = await qtyOf(f.user.id, f.bank.id);
  const sold = await createTransactionAction(null, saleForm(f.bank.id));
  assert.equal(sold.ok, true, sold.message);
  assert.match(sold.message, /خودرو ۱/);

  const [row] = await db.select().from(vehicleAssets).where(eq(vehicleAssets.id, car.id));
  assert.equal(row.status, "sold");
  const bankAfter = await qtyOf(f.user.id, f.bank.id);
  assert.ok(bankAfter.sub(bankBefore).sub("900000000").abs().lt("1"), `bank received ${bankAfter.sub(bankBefore)} Toman`);

  const entry = await lastEntry();
  const frozen = (await getEntryFxSnapshots([entry.id])).get(entry.id)!;
  assert.equal(frozen.trade?.tradeSymbol, "خودرو ۱");
  assert.equal(frozen.trade?.priceMode, "registry");
  assert.equal(D(frozen.trade!.settleQuantity!).toFixed(0), "900000000");

  const again = await createTransactionAction(null, saleForm(f.bank.id));
  assert.equal(again.ok, false);
  assert.match(again.message, /قبلاً فروخته/);
});
