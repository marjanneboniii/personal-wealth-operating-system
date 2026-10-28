/**
 * حساب معاملاتی — the case that started it: 143.91 USDC moved from a wallet
 * to Hyperliquid, 30 of it lost. A closed loss is an investment result (never
 * spending); an open loss is a mark that recovers or deepens without entries.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { eq } from "drizzle-orm";
import { D } from "../src/domain/decimal";
import { accounts, assetClasses, assets, journalEntries, userFxSettings, users, wallets, wallexAssetCatalog } from "../src/db/schema";
import { readHyperliquid, readLighter, perpVenueOf, realizedBalanceOf } from "../src/features/trading/venues";
import { todayIso } from "../src/lib/format";

const TODAY = todayIso();

test("venue readers take the documented numbers and refuse anything else", () => {
  const hl = readHyperliquid({
    marginSummary: { accountValue: "113.91" },
    assetPositions: [{ position: { unrealizedPnl: "-12.5" } }, { position: { unrealizedPnl: "2.5" } }],
  });
  assert.deepEqual(hl, { accountValue: "113.91", unrealizedPnl: "-10" });
  assert.equal(realizedBalanceOf(hl!), "123.91");
  assert.equal(readHyperliquid({ error: "x" }), null);

  const lighter = readLighter({
    accounts: [
      { total_asset_value: "100", positions: [{ unrealized_pnl: "-5" }] },
      { total_asset_value: "13.91", positions: [] },
    ],
  });
  assert.deepEqual(lighter, { accountValue: "113.91", unrealizedPnl: "-5" });
  assert.equal(readLighter({ code: 21100, message: "account not found" }), null, "no account → nothing, never a zero");
});

test("perp places are recognised by name, other places are not", () => {
  assert.equal(perpVenueOf("Hyperliquid")?.sync, "hyperliquid");
  assert.equal(perpVenueOf("لایتر رابین‌هود")?.sync, "lighter_rh");
  assert.equal(perpVenueOf("آرکوس")?.sync, null);
  assert.equal(perpVenueOf("ربی والت"), null);
});

test("deposit, closed loss, open loss, recovery — results stay out of spending", async () => {
  const { db } = await import("../src/db");
  const { createSchemaIfNotExists } = await import("../src/db/init-schema");
  const { postEntry } = await import("../src/features/ledger/service");
  const { getRealizedPnl, getExpenseIncomeTotals, getCashflow } = await import("../src/features/ledger/queries");
  const { getPortfolioValuation } = await import("../src/features/portfolio/service");
  const { listTradingAccounts, recordTradingMark, openPositionMarks } = await import("../src/features/trading/service");
  await createSchemaIfNotExists();

  const [user] = await db.insert(users).values({ name: "Trader", username: `perp-${Date.now()}`, role: "owner" } as any).returning();
  await db.insert(userFxSettings).values({ userId: user.id, currentRate: "100000" } as any);
  await db
    .insert(wallexAssetCatalog)
    .values({ symbol: "USDC", displayName: "یو‌اس‌دی‌سی", latinName: "USD Coin", kind: "stablecoin", priceTmn: "100000", priceUsdt: "1" } as any)
    .onConflictDoUpdate({ target: wallexAssetCatalog.symbol, set: { priceTmn: "100000" } });
  const stable =
    (await db.select().from(assetClasses).where(eq(assetClasses.code, "stable")))[0] ??
    (await db.insert(assetClasses).values({ code: "stable", name: "استیبل‌کوین" } as any).returning())[0];
  const usdc =
    (await db.select().from(assets).where(eq(assets.symbol, "USDC")))[0] ??
    (await db.insert(assets).values({ symbol: "USDC", name: "USDC", classId: stable.id, decimals: 6 } as any).returning())[0];
  const [rabby] = await db.insert(wallets).values({ userId: user.id, name: "ربی والت", kind: "hot" } as any).returning();
  const [hl] = await db.insert(wallets).values({ userId: user.id, name: "هایپرلیکوئید", kind: "exchange" } as any).returning();
  const acc = async (code: string, name: string, type: string, walletId: string | null) =>
    (await db.insert(accounts).values({ code, name, type, assetId: usdc.id, walletId, userId: user.id } as any).returning())[0];
  const wallet = await acc("1301", "USDC - ربی والت", "asset", rabby.id);
  const margin = await acc("1302", "USDC - هایپرلیکوئید", "asset", hl.id);
  const equity = await acc("3011", "سرمایه افتتاحیه", "equity", null);

  await postEntry({
    entryDate: TODAY, type: "opening", description: "افتتاحیه", userId: user.id,
    postings: [
      { accountId: wallet.id, assetId: usdc.id, quantity: "143.91", baseValue: "143.91" },
      { accountId: equity.id, assetId: usdc.id, quantity: "-143.91", baseValue: "-143.91" },
    ],
  });
  await postEntry({
    entryDate: TODAY, type: "transfer", description: "واریز به هایپرلیکوئید", userId: user.id,
    postings: [
      { accountId: margin.id, assetId: usdc.id, quantity: "143.91", baseValue: "143.91" },
      { accountId: wallet.id, assetId: usdc.id, quantity: "-143.91", baseValue: "-143.91" },
    ],
  });

  // 1) Positions closed at a 30 loss: one entry, −30 realized.
  const closed = await recordTradingMark(user.id, margin.id, { accountValue: "113.91", unrealizedPnl: "0" });
  assert.equal(D(closed.realizedChange).toString(), "-30");
  const [entry] = await db.select().from(journalEntries).where(eq(journalEntries.id, closed.entryId!));
  assert.match(entry.description, /زیان معاملات هایپرلیکوئید/);
  let [view] = await listTradingAccounts(user.id);
  assert.equal(D(view.ledgerBalance).toString(), "113.91");
  assert.equal(D(view.netDeposited).toString(), "143.91", "the deposit, not the result");

  // A trading loss is an investment result: not spending, not in cash flow.
  const pnl = await getRealizedPnl(user.id);
  assert.equal(D(pnl.bySymbol.find((r) => r.symbol === "معاملات پرپ")!.pnl).toString(), "-30");
  assert.equal(D(pnl.bySymbol.find((r) => r.symbol === "معاملات پرپ")!.pnlToman).toFixed(0), "-3000000");
  assert.equal(D((await getExpenseIncomeTotals(user.id)).expense).toString(), "0");
  assert.ok((await getCashflow(1, user.id)).every((m) => D(m.outflow).isZero()));

  // 2) A new trade is open, 10 under water; realized balance unchanged → no entry.
  const open = await recordTradingMark(user.id, margin.id, { accountValue: "103.91", unrealizedPnl: "-10" });
  assert.equal(open.entryId, null, "an open loss is a mark, not an entry");
  [view] = await listTradingAccounts(user.id);
  assert.equal(D(view.accountValue).toString(), "103.91");
  const marks = await openPositionMarks(user.id, TODAY);
  assert.equal(marks[0].unrealizedPnl.toString(), "-10");
  const valuation = await getPortfolioValuation(undefined, user.id);
  const usdcRow = valuation.assetValuations.find((a) => a.symbol === "USDC")!;
  assert.equal(D(usdcRow.currentValue).toFixed(2), "103.91", "net worth carries the open loss");

  // 3) The position recovers to +5 and is still open: still no entry.
  const recovered = await recordTradingMark(user.id, margin.id, { accountValue: "118.91", unrealizedPnl: "5" });
  assert.equal(recovered.entryId, null);
  // 4) …and is closed at +5: the realized balance moves, one entry.
  const won = await recordTradingMark(user.id, margin.id, { accountValue: "118.91", unrealizedPnl: "0" });
  assert.equal(D(won.realizedChange).toString(), "5");
  assert.equal(D((await getRealizedPnl(user.id)).bySymbol.find((r) => r.symbol === "معاملات پرپ")!.pnl).toString(), "-25");
});

test("guards: a synced zero is refused, an open loss bigger than the account is refused, other places are refused", async () => {
  const { db } = await import("../src/db");
  const { recordTradingMark } = await import("../src/features/trading/service");
  const [margin] = await db.select().from(accounts).where(eq(accounts.name, "USDC - هایپرلیکوئید"));
  const [wallet] = await db.select().from(accounts).where(eq(accounts.name, "USDC - ربی والت"));
  await assert.rejects(
    recordTradingMark(margin.userId!, margin.id, { accountValue: "0", unrealizedPnl: "0", source: "hyperliquid" }),
    /ارزش صفر/,
  );
  await assert.rejects(recordTradingMark(margin.userId!, margin.id, { accountValue: "10", unrealizedPnl: "50" }), /بیشتر است/);
  await assert.rejects(recordTradingMark(margin.userId!, wallet.id, { accountValue: "10", unrealizedPnl: "0" }), /پلتفرم پرپ نیست/);
});
