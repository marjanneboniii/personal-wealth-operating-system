/**
 * شاخص‌های سلامت ثروت — Adjusted Return / Net Investment Return audit.
 *
 * Reproduces the reported fake negative:
 *   «بازده سرمایه‌گذاری خالص: −۶٬۷۵۷٬۳۷۴٬۷۷۷ تومان ≈ −۳۲٬۱۷۷.۹۸ دلار
 *    · بدون احتساب واریز/برداشت‌ها»
 *
 * ROOT CAUSE (fixed in analytics/service.ts):
 * The analytics engine read `portfolio_snapshots`, which NO UI writes (the
 * «ثبت اسنپ‌شات» button writes the legacy `snapshots` history). With zero
 * starting snapshots it fell back to TODAY's total cost basis as "period
 * start" — a value that ALREADY embeds every deposit — then subtracted the
 * same capital flows from it a second time:
 *   start = current cost basis (includes 32,177.98 deposit)
 *   netInvestmentReturn = (end − start) − netExternalFlows = 0 − 32,177.98
 *   ⇒ −32,177.98 USD = exactly −6,757,374,777 Toman at 210,000 IRT/USD.
 *
 * The fix uses a REAL historical snapshot (legacy snapshots + portfolio
 * snapshots merged; both tenant-scoped) as the starting value, counts flows
 * strictly AFTER that snapshot, and reports honest "missing data" instead of
 * a fabricated number when no history exists.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { eq } from "drizzle-orm";
import { db } from "../src/db";
import { createSchemaIfNotExists } from "../src/db/init-schema";
import {
  accounts,
  assetClasses,
  assets,
  currencies,
  journalEntries,
  postings,
  prices,
  snapshots,
  snapshotLines,
  users,
  userFxSettings,
  portfolioSnapshots,
} from "../src/db/schema";
import { postEntry } from "../src/features/ledger/service";
import { getAnalyticsSummary } from "../src/features/analytics/service";
import { D } from "../src/domain/decimal";
import { irtToUsd, toIrtMoney, usdToIrt } from "../src/lib/format";

let seq = 0;

async function setup(opts: { rate?: string; allowSecondUser?: boolean } = {}) {
  await createSchemaIfNotExists();
  // analytics_runs is append-only at the DB level — never touched here.
  await db.delete(portfolioSnapshots);
  await db.delete(snapshotLines);
  await db.delete(snapshots);
  await db.delete(prices);
  await db.delete(postings);
  await db.delete(journalEntries);
  await db.delete(accounts);
  await db.delete(assets);
  await db.delete(assetClasses);
  await db.delete(currencies);
  await db.delete(userFxSettings);
  await db.delete(users);

  seq += 1;
  const [user] = await db
    .insert(users)
    .values({ name: `Wealth${seq}`, username: `wealth-${Date.now()}-${seq}`, role: "owner" } as any)
    .returning();
  await db.insert(userFxSettings).values({ userId: user.id, currentRate: opts.rate ?? "210000" } as any);

  const [usd] = await db
    .insert(currencies)
    .values({ code: "USD", name: "US Dollar", symbol: "$", decimals: 2, isFiat: true })
    .returning();
  const [otherCls] = await db
    .insert(assetClasses)
    .values({ code: "other", name: "سایر دارایی‌ها", color: "#888" })
    .returning();
  const [usdAsset] = await db
    .insert(assets)
    .values({ symbol: "USD", name: "USD Cash", classId: otherCls.id, currencyId: usd.id, decimals: 2 })
    .returning();
  const [gold] = await db
    .insert(assets)
    .values({ symbol: "GOLD18", name: "طلای ۱۸ عیار", classId: otherCls.id, currencyId: usd.id, decimals: 4 })
    .returning();

  const [cash] = await db
    .insert(accounts)
    .values({ code: "1010", name: "بانک", type: "asset", assetId: usdAsset.id, userId: user.id })
    .returning();
  const [goldAcc] = await db
    .insert(accounts)
    .values({ code: "1200", name: "طلای فیزیکی", type: "asset", assetId: gold.id, userId: user.id })
    .returning();
  const [equity] = await db
    .insert(accounts)
    .values({ code: "3010", name: "سرمایه افتتاحیه", type: "equity", assetId: usdAsset.id, userId: user.id })
    .returning();

  return { user, usd, gold, usdAsset, cash, goldAcc, equity };
}

/** Legacy `snapshots` history — the table the «ثبت اسنپ‌شات» button actually writes. */
async function insertLegacySnapshot(userId: string, asOf: string, totalAssets: string) {
  await db.insert(snapshots).values({
    userId,
    asOf,
    baseCurrency: "USD",
    totalAssets,
    totalLiabilities: "0",
    netWorth: totalAssets,
  } as any);
}

async function postOpening(userId: string, date: string, description: string, amount: string, setupRes: any) {
  await postEntry({
    entryDate: date,
    type: "opening",
    description,
    userId,
    postings: [
      { accountId: setupRes.cash.id, assetId: setupRes.usdAsset.id, quantity: amount, baseValue: amount },
      { accountId: setupRes.equity.id, assetId: setupRes.usdAsset.id, quantity: D(amount).neg().toString(), baseValue: D(amount).neg().toString() },
    ],
  });
}

async function postCapitalOut(userId: string, date: string, amount: string, setupRes: any) {
  await postEntry({
    entryDate: date,
    type: "opening",
    description: "برداشت سرمایه",
    userId,
    postings: [
      { accountId: setupRes.cash.id, assetId: setupRes.usdAsset.id, quantity: D(amount).neg().toString(), baseValue: D(amount).neg().toString() },
      { accountId: setupRes.equity.id, assetId: setupRes.usdAsset.id, quantity: amount, baseValue: amount },
    ],
  });
}

test("deposit alone creates ZERO investment return (no fake loss)", async () => {
  const s = await setup();
  // 2026-08-15 snapshot: 50,000 USD portfolio.
  await postOpening(s.user.id, "2026-08-01", "افتتاحیه — بانک", "50000", s);
  await insertLegacySnapshot(s.user.id, "2026-08-15", "50000");
  // Deposit AFTER the snapshot (+10,000 on 2026-08-20) — pure cash-in.
  await postOpening(s.user.id, "2026-08-20", "افتتاحیه — واریز اولیه", "10000", s);

  const summary = await getAnalyticsSummary(s.user.id);
  const g = summary.growth;
  assert.equal(g.calculationStatus, "complete");
  assert.equal(g.periodStart, "2026-08-15");
  assert.equal(D(g.startingValue).toFixed(2), "50000.00");
  assert.equal(D(g.endingValue).toFixed(2), "60000.00");
  assert.equal(D(g.absoluteChange).toFixed(2), "10000.00");
  assert.equal(D(g.netExternalCapitalFlows).toFixed(2), "10000.00");
  // Money in ⇒ NO return, NO fake −10,000 loss:
  assert.equal(D(g.netInvestmentReturn).toFixed(2), "0.00");
  assert.equal(g.adjustedWealthReturnPercentage, "0.00");
});

test("withdrawal alone creates ZERO investment loss (no fake -return)", async () => {
  const s = await setup();
  await postOpening(s.user.id, "2026-08-01", "افتتاحیه — بانک", "50000", s);
  await insertLegacySnapshot(s.user.id, "2026-08-15", "50000");
  // −10,000 pure cash-out on 2026-08-20.
  await postCapitalOut(s.user.id, "2026-08-20", "10000", s);

  const g = (await getAnalyticsSummary(s.user.id)).growth;
  assert.equal(D(g.absoluteChange).toFixed(2), "-10000.00");
  assert.equal(D(g.netExternalCapitalFlows).toFixed(2), "-10000.00");
  assert.equal(D(g.netInvestmentReturn).toFixed(2), "0.00", "withdrawal must not manufacture a loss");
  assert.equal(g.adjustedWealthReturnPercentage, "0.00");
});

test("no historical snapshot ⇒ honest missing data (no fabricated -29.99%)", async () => {
  const s = await setup();
  await postOpening(s.user.id, "2026-09-01", "افتتاحیه — بانک", "32177.98", s);
  // NO snapshot rows at all (portfolio_snapshots is never written by the UI).
  const summary = await getAnalyticsSummary(s.user.id);
  const g = summary.growth;
  assert.equal(g.calculationStatus, "missing_data");
  assert.ok(g.missingDataWarning, "must explain why the metric is unavailable");
  assert.equal(D(g.netInvestmentReturn).toFixed(2), "0.00", "no snapshot ⇒ no fabricated return");
  assert.equal(g.adjustedWealthReturnPercentage, "0.00");
  assert.equal(D(g.startingValue).toFixed(2), "0.00", "cost basis must never act as a fake period start");
});

test("genuine market gain is still reported (fix never clamps real returns)", async () => {
  const s = await setup();
  await postOpening(s.user.id, "2026-08-01", "افتتاحیه — بانک و طلا", "50000", s);
  await insertLegacySnapshot(s.user.id, "2026-08-15", "50000");
  // Buy 1 unit gold @ 3,000 (cash −3,000) — internal move, NOT a capital flow.
  await postEntry({
    entryDate: "2026-08-20",
    type: "buy",
    description: "خرید طلا",
    userId: s.user.id,
    postings: [
      { accountId: s.cash.id, assetId: s.usdAsset.id, quantity: "-3000", baseValue: "-3000" },
      { accountId: s.goldAcc.id, assetId: s.gold.id, quantity: "1", baseValue: "3000" },
    ],
  });
  // Gold revalues to 3,500 USD/unit on 2026-08-21 → +500 genuine gain.
  await db.insert(prices).values({ assetId: s.gold.id, priceBase: "3500", asOf: "2026-08-21" } as any);

  const g = (await getAnalyticsSummary(s.user.id)).growth;
  assert.equal(D(g.endingValue).toFixed(2), "50500.00", "cash 47,000 + gold 3,500");
  assert.equal(D(g.netExternalCapitalFlows).toFixed(2), "0.00", "buy is not a capital flow");
  assert.equal(D(g.netInvestmentReturn).toFixed(2), "500.00", "real +500 gain must survive");
  assert.equal(g.adjustedWealthReturnPercentage, "1.00");
});

test("FX: Toman and USD figures are one consistent conversion (no double conversion)", () => {
  // The user-reported pair: −6,757,374,777 Toman ≈ −32,177.98 USD.
  const rate = "210000";
  const toman = usdToIrt("32177.98", rate);
  assert.equal(toman, "6757375800");
  const ratio = D(toman).div("32177.98");
  assert.ok(D(ratio).sub(rate).abs().lt("1"), `implied rate must be ${rate}: ${ratio}`);
  // Round trip stays the same figure.
  assert.equal(irtToUsd(toman, rate), "32177.98");
  // toIrtMoney (UI path for «بازده سرمایه‌گذاری خالص») is non-null at a valid rate.
  assert.ok(toIrtMoney("32177.98", rate) !== null);
});

test("multi-user isolation: historical snapshots of user B never enter A's wealth metrics", async () => {
  const a = await setup();
  // Add a second tenant with its own scoped accounts and history.
  seq += 1;
  const [userB] = await db
    .insert(users)
    .values({ name: `WealthB${seq}`, username: `wealth-b-${Date.now()}-${seq}`, role: "owner" } as any)
    .returning();
  await db.insert(userFxSettings).values({ userId: userB.id, currentRate: "210000" } as any);
  // Assets/currencies are global; accounts + postings carry the tenant scope.
  const [cashB] = await db
    .insert(accounts)
    .values({ code: "1010", name: "بانک B", type: "asset", assetId: a.usdAsset.id, userId: userB.id })
    .returning();
  const [equityB] = await db
    .insert(accounts)
    .values({ code: "3010", name: "سرمایه افتتاحیه B", type: "equity", assetId: a.usdAsset.id, userId: userB.id })
    .returning();

  await postEntry({
    entryDate: "2026-08-01",
    type: "opening",
    description: "افتتاحیه — بانک B",
    userId: userB.id,
    postings: [
      { accountId: cashB.id, assetId: a.usdAsset.id, quantity: "70000", baseValue: "70000" },
      { accountId: equityB.id, assetId: a.usdAsset.id, quantity: "-70000", baseValue: "-70000" },
    ],
  });
  await insertLegacySnapshot(userB.id, "2026-08-15", "70000");

  // A's own history: 50,000.
  await postOpening(a.user.id, "2026-08-01", "افتتاحیه — بانک A", "50000", a);
  await insertLegacySnapshot(a.user.id, "2026-08-15", "50000");

  const summaryA = await getAnalyticsSummary(a.user.id);
  const summaryB = await getAnalyticsSummary(userB.id);

  assert.equal(D(summaryA.growth.startingValue).toFixed(2), "50000.00", "A starts at 50k, not 70k");
  assert.equal(D(summaryB.growth.startingValue).toFixed(2), "70000.00", "B starts at 70k");
  assert.equal(summaryA.timeline.length, 1);
  assert.ok(D(summaryA.timeline[0].portfolioValue).sub("50000").isZero(), "A's timeline contains only A's value");
  assert.ok(D(summaryB.timeline[0].portfolioValue).sub("70000").isZero(), "B's timeline contains only B's value");
});
