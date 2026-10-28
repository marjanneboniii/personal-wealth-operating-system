/**
 * Toman and dollar results of an Iranian investor, end to end.
 *
 *  • Toman → tether → ether → part sold: the realized result is counted in
 *    Toman as received − paid (each at its own frozen rate), never as the
 *    dollar result × today's rate; the dollar result stays beside it.
 *  • A stablecoin's cost is the weighted average of what was paid for it,
 *    never a setup lot that nothing consumes (that showed a fake loss).
 *  • Realized results and trade/swap fees are not the month's income,
 *    spending, cash flow or savings.
 *  • A reconcile adjustment records WHY («پول جای دیگری رفت: YT در Pendle»).
 *  • An exchange or wallet can hold any dollar stablecoin, with a Toman price.
 */
import assert from "node:assert/strict";
import { todayIso } from "../src/lib/format";
import { test, mock } from "node:test";
import { and, eq } from "drizzle-orm";
import { D } from "../src/domain/decimal";
import {
  accounts,
  assetClasses,
  assets,
  entryFxSnapshots,
  journalEntries,
  users,
  userFxSettings,
  wallets,
  wallexAssetCatalog,
} from "../src/db/schema";
import { foldStablecoinCost } from "../src/features/portfolio/stablecoinCost";
import { reconcileDescription } from "../src/features/reconcile/reasons";
import { STABLECOIN_SYMBOLS } from "../src/lib/stablecoins";
import { readFileSync } from "node:fs";

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

// The app's «امروز» is the Tehran day (see todayIso); a UTC date is yesterday after 20:30 UTC.
const TODAY = todayIso();

/** Tether's market price, served from the price cache through the client seam — never the network. */
async function seedTetherPrice() {
  const { getCurrentUsdPrices } = await import("../src/features/pricing/service");
  const { CoinGeckoClient } = await import("../src/features/pricing/coingecko");
  const fetchImpl: typeof fetch = async () =>
    new Response(JSON.stringify({ tether: { usd: 1, last_updated_at: Math.floor(Date.now() / 1000) } }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  await getCurrentUsdPrices(
    [{ assetId: "usdt", coingeckoId: "tether", symbol: "USDT", name: "Tether", logoUrl: null }],
    { client: new CoinGeckoClient({ fetchImpl, apiKey: null }), spotQuotes: null },
  );
}
const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

test("stablecoin average cost: a setup purchase, then a sale, then a swap from Toman", () => {
  // 1000 tether entered in setup at 50,000 Toman each; 600 sold; 330 bought with 50M Toman.
  const after = foldStablecoinCost(
    [
      { qty: "1000", base: "1000", fxRate: "100000", tomanPaid: "0", lotQty: "1000", lotToman: "50000000" },
      { qty: "-600", base: "-600", fxRate: "100000", tomanPaid: "0", lotQty: "0", lotToman: "0" },
    ],
    "100000",
  );
  assert.equal(after.quantity, "400");
  assert.equal(after.costToman, "20000000", "the 400 left cost 20M — not the whole setup lot");
  assert.equal(after.avgToman, "50000");

  const swapped = foldStablecoinCost(
    [{ qty: "330", base: "330", fxRate: "150000", tomanPaid: "50000000", lotQty: "0", lotToman: "0" }],
    "150000",
  );
  assert.equal(swapped.costToman, "50000000", "the Toman actually paid, fee and spread included");
  assert.equal(swapped.tomanPaidQuantity, "330");
});

test("one stablecoin list for trade, setup and pricing", () => {
  for (const s of ["USDT", "USDC", "BUSD", "USDD", "DAI"]) assert.ok(STABLECOIN_SYMBOLS.has(s), s);
  for (const file of ["src/features/setup/service.ts", "src/features/pricing/providers/wallex.ts", "src/features/trade/rules.ts"]) {
    assert.doesNotMatch(read(file), /new Set\(\["USDT", "USDC"/, `${file} keeps no private copy`);
  }
});

test("the realized list is money, never units of the asset sold", () => {
  const page = read("src/app/portfolio/page.tsx");
  assert.doesNotMatch(page, /formatSignedMoney\(p\.pnl, p\.symbol\)/);
  assert.match(page, /formatSignedMoney\(p\.pnlToman, "IRT"\)/);
  assert.doesNotMatch(read("src/app/reports/page.tsx"), /formatSignedMoneyFromUsd\(pnl\.total/);
  assert.doesNotMatch(read("src/app/reports/page.tsx"), /formatSignedMoney\(s\.pnl, s\.symbol\)/, "the reports list too");
});

test("reconcile reasons are written into the entry's description", () => {
  assert.equal(reconcileDescription("تتر - بایننس"), "تطبیق موجودی «تتر - بایننس» با بانک");
  assert.equal(
    reconcileDescription("تتر - بایننس", "elsewhere", "  YT در   Pendle "),
    "اصلاح موجودی «تتر - بایننس» — پول جای دیگری رفت: YT در Pendle",
  );
});

test("Toman → tether → ether → 30% sold: Toman and dollar results, monthly reports untouched", async () => {
  const { db } = await import("../src/db");
  const { createSchemaIfNotExists } = await import("../src/db/init-schema");
  const { createSession } = await import("../src/lib/auth");
  const { createTransactionAction } = await import("../src/app/actions");
  const { postEntry } = await import("../src/features/ledger/service");
  const { getRealizedPnl, getExpenseIncomeTotals, getCashflow, getNetSavingsBetween } = await import("../src/features/ledger/queries");
  const { getPortfolioValuation } = await import("../src/features/portfolio/service");
  const { createReadySession } = await import("./support/ready-session");
  await createSchemaIfNotExists();
  void createSession;

  const [user] = await db.insert(users).values({ name: "Investor", username: `inv-${Date.now()}`, role: "owner" } as any).returning();
  await db.insert(userFxSettings).values({ userId: user.id, currentRate: "150000" } as any);
  await db
    .insert(wallexAssetCatalog)
    .values({ symbol: "USDT", displayName: "تتر", latinName: "Tether", kind: "stablecoin", priceTmn: "150000", priceUsdt: "1" } as any)
    .onConflictDoUpdate({ target: wallexAssetCatalog.symbol, set: { priceTmn: "150000" } });
  const cls = async (code: string, name: string) =>
    (await db.select().from(assetClasses).where(eq(assetClasses.code, code)))[0] ??
    (await db.insert(assetClasses).values({ code, name } as any).returning())[0];
  const cash = await cls("cash", "نقد و بانک");
  const stable = await cls("stable", "استیبل‌کوین");
  const crypto = await cls("crypto", "رمزارز");
  const asset = async (symbol: string, classId: string, decimals: number) =>
    (await db.select().from(assets).where(eq(assets.symbol, symbol)))[0] ??
    (await db.insert(assets).values({ symbol, name: symbol, classId, decimals } as any).returning())[0];
  await asset("USD", cash.id, 2);
  const irt = await asset("IRT", cash.id, 0);
  const usdt = await asset("USDT", stable.id, 6);
  const eth = await asset("ETH", crypto.id, 8);
  const [nobitex] = await db.insert(wallets).values({ userId: user.id, name: "نوبیتکس", kind: "exchange" } as any).returning();
  const acc = async (code: string, name: string, type: string, assetId: string, walletId: string | null = null) =>
    (await db.insert(accounts).values({ code, name, type, assetId, walletId, userId: user.id } as any).returning())[0];
  const toman = await acc("1610", "تومان - نوبیتکس", "asset", irt.id, nobitex.id);
  const tether = await acc("1200", "تتر - نوبیتکس", "asset", usdt.id, nobitex.id);
  const ether = await acc("1210", "اتریوم - نوبیتکس", "asset", eth.id, nobitex.id);
  const equity = await acc("3010", "سرمایه افتتاحیه", "equity", irt.id);
  await postEntry({
    entryDate: TODAY, type: "opening", description: "افتتاحیه", userId: user.id,
    postings: [
      { accountId: toman.id, assetId: irt.id, quantity: "100000000", baseValue: "666.666667" },
      { accountId: equity.id, assetId: irt.id, quantity: "-100000000", baseValue: "-666.666667" },
    ],
  });
  cookieJar.value = (await createReadySession(user.id)).token;
  const trade = (f: Record<string, string>) => {
    const fd = new FormData();
    for (const [k, v] of Object.entries({ entryDate: TODAY, feeMode: "irt", priceMode: "limit", ...f })) fd.set(k, v);
    return createTransactionAction(null, fd);
  };
  const setRate = async (rate: string) => {
    await db.update(userFxSettings).set({ currentRate: rate } as any).where(eq(userFxSettings.userId, user.id));
    await db.update(wallexAssetCatalog).set({ priceTmn: rate } as any).where(eq(wallexAssetCatalog.symbol, "USDT"));
  };

  // 50M Toman → 330 tether (fees and spread included), then 330 tether → 0.165 ETH at 2000.
  const toTether = await trade({ type: "buy", description: "خرید تتر", primaryAccountId: tether.id, counterAccountId: toman.id, quantity: "330", unitPrice: "151515", settleQuantity: "50000000", irtAmount: "50000000", fee: "20000" });
  assert.equal(toTether.ok, true, toTether.message);
  const toEth = await trade({ type: "buy", description: "خرید اتریوم", primaryAccountId: ether.id, counterAccountId: tether.id, quantity: "0.165", unitPrice: "2000", settleQuantity: "330", irtAmount: "49500000" });
  assert.equal(toEth.ok, true, toEth.message);

  // ETH 3000, tether 250,000 Toman: 30% sold for tether.
  await setRate("250000");
  const sale = await trade({ type: "sell", description: "فروش ۳۰٪ اتریوم", primaryAccountId: ether.id, counterAccountId: tether.id, quantity: "0.0495", unitPrice: "3000", settleQuantity: "148.5", irtAmount: "37125000" });
  assert.equal(sale.ok, true, sale.message);

  await seedTetherPrice();
  const pnl = await getRealizedPnl(user.id);
  const ethRow = pnl.bySymbol.find((r) => r.symbol === "ETH")!;
  assert.ok(D(ethRow.pnl).sub("49.5").abs().lt("0.01"), `dollar result ${ethRow.pnl}`);
  // received 148.5 × 250,000 = 37,125,000 − paid 99 × 150,000 = 14,850,000
  assert.ok(D(ethRow.pnlToman).sub("22275000").abs().lt("5"), `Toman result ${ethRow.pnlToman}`);
  assert.ok(D(pnl.totalToman).sub("22275000").abs().lt("5"));
  assert.notEqual(D(ethRow.pnlToman).toFixed(0), D(ethRow.pnl).mul("250000").toFixed(0), "never dollar result × today's rate");

  // The 148.5 tether received carry their Toman value of that day; dollar P&L is zero.
  const valuation = await getPortfolioValuation(undefined, user.id);
  const usdtRow = valuation.assetValuations.find((a) => a.symbol === "USDT")!;
  assert.equal(D(usdtRow.quantity).toString(), "148.5");
  assert.equal(D(usdtRow.costBasis).toString(), "148.5", "tether at face: cost = quantity");
  assert.equal(D(usdtRow.unrealizedPnl).toString(), "0");
  assert.equal(usdtRow.dca?.dcaUnitPriceToman, "250000");

  // Neither the realized result nor the swap fee is the month's income or spending.
  const totals = await getExpenseIncomeTotals(user.id);
  assert.equal(D(totals.income).toString(), "0", "a sale's result is not income of the month");
  assert.equal(D(totals.expense).toString(), "0", "a swap's fee is not spending of the month");
  const flow = await getCashflow(1, user.id);
  assert.ok(flow.every((m) => D(m.inflow).isZero() && D(m.outflow).isZero()));
  assert.equal(D(await getNetSavingsBetween("2000-01-01", TODAY, user.id)).toString(), "0");
  // …but the fee is still on the entry, where the user sees what left the account.
  const [buyEntry] = await db.select().from(journalEntries).where(and(eq(journalEntries.userId, user.id), eq(journalEntries.description, "خرید تتر")));
  const [snap] = await db.select().from(entryFxSnapshots).where(eq(entryFxSnapshots.entryId, buyEntry.id));
  assert.ok(snap, "the swap keeps its frozen Toman");
  cookieJar.value = null;
});

test("tether entered in setup, 600 of 1000 sold: no fake loss, Toman cost of the 400 left", async () => {
  const { db } = await import("../src/db");
  const { finishSetup } = await import("../src/features/setup/workflow");
  const { recordFx } = await import("../src/features/ledger/service");
  const { getPortfolioValuation } = await import("../src/features/portfolio/service");
  const { resolveAutomaticPurchaseRate } = await import("../src/features/rwa/vehicle/fx");
  const [u] = await db.insert(users).values({ name: "تتری", username: `usdt-${Date.now()}`, role: "user" } as any).returning();
  const date = "2023-08-11";
  await resolveAutomaticPurchaseRate(date, u.id);
  const input: any = {
    userName: "تتری", baseCurrency: "USD", displayCurrency: "IRT", dateCalendar: "jalali", digitStyle: "fa", fxRate: "100000",
    bankAccountName: "ملت", bankName: "ملت", bankOpeningBalance: "1000000", bankAssetSymbol: "IRT",
    cryptoHoldings: [{ symbol: "USDT", quantity: "1000", unitPrice: "50000", priceCurrency: "IRT", walletName: "بایننس", purchaseDate: date }],
  };
  const done = await finishSetup(u.id, input, { holdings: "yes", instruments: "no", properties: "no", vehicles: "no", debts: "no" } as any, []);
  assert.equal(done.ok, true, (done as any).message);
  const [usdtAsset] = await db.select().from(assets).where(eq(assets.symbol, "USDT"));
  const [irtAsset] = await db.select().from(assets).where(eq(assets.symbol, "IRT"));
  const [wallet] = await db.select().from(accounts).where(and(eq(accounts.userId, u.id), eq(accounts.assetId, usdtAsset.id)));
  const [bank] = await db.select().from(accounts).where(and(eq(accounts.userId, u.id), eq(accounts.assetId, irtAsset.id)));
  // What «فروش تتر» does: a conversion, no lot touched.
  await recordFx({
    entryDate: TODAY, description: "فروش ۶۰۰ تتر", userId: u.id,
    fromAccountId: wallet.id, toAccountId: bank.id, fromAssetId: usdtAsset.id, toAssetId: irtAsset.id,
    fromQuantity: "600", toQuantity: "60000000", bookValue: "600",
  } as any);

  await seedTetherPrice();
  const valuation = await getPortfolioValuation(undefined, u.id);
  const row = valuation.assetValuations.find((a) => a.symbol === "USDT")!;
  assert.equal(D(row.quantity).toString(), "400");
  assert.equal(D(row.costBasis).toString(), "400", "not the 1000-tether setup lot");
  assert.equal(D(row.unrealizedPnl).toString(), "0", "no fake dollar loss on tether");
  assert.ok(row.dca && D(row.dca.totalCostToman).sub("20000000").abs().lt("2"), `Toman cost ${row.dca?.totalCostToman}`);
  assert.equal(row.dca?.dcaUnitPriceToman, "50000", "the price typed in setup survives");
});

test("reconcile with a reason; an exchange holds USDC with its Toman price", async () => {
  const { db } = await import("../src/db");
  const { registerMoneyAccount, listMoneyAccountCurrencies } = await import("../src/features/accounts/service");
  const { recordBalanceCheckpoint, adjustToReported } = await import("../src/features/reconcile/service");
  const [u] = await db.insert(users).values({ name: "YT", username: `yt-${Date.now()}`, role: "user" } as any).returning();
  await db.insert(userFxSettings).values({ userId: u.id, currentRate: "150000" } as any);
  const currencies = await listMoneyAccountCurrencies();
  const usdc = currencies.find((c) => c.symbol === "USDC")!;
  const usdtCurrency = currencies.find((c) => c.symbol === "USDT")!;
  assert.ok(usdc, "USDC is offered for exchanges and wallets");

  await assert.rejects(
    registerMoneyAccount({ name: "USDC بانکی", kind: "bank", assetId: usdc.id, openingQty: "10", userId: u.id }),
    /صرافی یا کیف پول/,
  );
  const opened = await registerMoneyAccount({
    name: "USDC - بایننس", kind: "exchange", assetId: usdc.id, placeName: "بایننس", openingQty: "100", purchasePriceToman: "140000", userId: u.id,
  });
  const [snap] = await db.select().from(entryFxSnapshots).where(eq(entryFxSnapshots.entryId, opened.entryId!));
  assert.equal(D(snap.irtAmount).toString(), "14000000", "100 × the 140,000 Toman typed");

  // 1000 tether went into YT: the balance is set to zero, with the reason.
  const yt = await registerMoneyAccount({ name: "تتر - ربی والت", kind: "hot", assetId: usdtCurrency.id, placeName: "ربی والت", openingQty: "1000", userId: u.id });
  const cp = await recordBalanceCheckpoint({ userId: u.id, accountId: yt.accountId!, asOf: TODAY, balance: "0", source: "manual" });
  const adj = await adjustToReported(u.id, cp.id, { reason: "elsewhere", note: "YT در Pendle" });
  const [entry] = await db.select().from(journalEntries).where(eq(journalEntries.id, adj.entryId));
  assert.equal(entry.description, "اصلاح موجودی «تتر - ربی والت» — پول جای دیگری رفت: YT در Pendle");
  assert.equal(entry.type, "adjustment");
});
