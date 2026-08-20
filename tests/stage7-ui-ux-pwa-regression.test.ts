import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs";
import path from "node:path";
import { db } from "../src/db";
import { createSchemaIfNotExists } from "../src/db/init-schema";
import {
  accounts,
  assets,
  assetClasses,
  auditLog,
  currencies,
  entryFxSnapshots,
  journalEntries,
  lots,
  lotConsumptions,
  postings,
  users,
  userFxSettings,
  wallets,
} from "../src/db/schema";
import { eq, sql } from "drizzle-orm";
import {
  recordBuy,
  recordExpense,
  recordIncome,
  recordSell,
  recordTransfer,
} from "../src/features/ledger/service";
import {
  getAccountBalances,
  getHoldings,
  getLedger,
  getNetWorth,
  getOpenLots,
  getRealizedPnl,
} from "../src/features/ledger/queries";
import { runStage3IntegrityAudit } from "../src/features/integrity/service";
import { updateUserFxRate } from "../src/features/fx/userRate";
import { createSession } from "../src/lib/auth";

async function setupStage7Scenario() {
  await createSchemaIfNotExists();
  await db.delete(auditLog);
  await db.delete(lotConsumptions);
  await db.delete(lots);
  await db.delete(entryFxSnapshots);
  await db.delete(postings);
  await db.delete(journalEntries);
  await db.delete(accounts);
  await db.delete(wallets);
  await db.delete(assets);
  await db.delete(assetClasses);
  await db.delete(currencies);
  await db.delete(userFxSettings);
  await db.delete(users);

  const [usd] = await db.insert(currencies).values({ code: "USD", name: "US Dollar", symbol: "$", decimals: 2, isFiat: true } as any).returning();
  const [irt] = await db.insert(currencies).values({ code: "IRT", name: "Toman", symbol: "T", decimals: 0, isFiat: true } as any).returning();

  const [cryptoClass] = await db.insert(assetClasses).values({ code: "crypto", name: "Crypto", valuationMethod: "fifo" } as any).returning();
  const [cashClass] = await db.insert(assetClasses).values({ code: "cash", name: "Cash", valuationMethod: "fifo" } as any).returning();

  const [btc] = await db.insert(assets).values({ symbol: "BTC", name: "Bitcoin", classId: cryptoClass.id, currencyId: usd.id } as any).returning();
  const [usdCash] = await db.insert(assets).values({ symbol: "USD_CASH", name: "USD Cash", classId: cashClass.id, currencyId: usd.id } as any).returning();
  const [irtCash] = await db.insert(assets).values({ symbol: "IRT_CASH", name: "IRT Cash", classId: cashClass.id, currencyId: irt.id } as any).returning();

  const [userA] = await db.insert(users).values({ name: "User A", username: "usera_s7", role: "owner" } as any).returning();
  await db.insert(userFxSettings).values({ userId: userA.id, currentRate: "190000" } as any);

  const [cashUsdA] = await db.insert(accounts).values({ code: "1010", name: "Cash USD A", type: "asset", assetId: usdCash.id, userId: userA.id } as any).returning();
  const [cashIrtA] = await db.insert(accounts).values({ code: "1011", name: "Cash IRT A", type: "asset", assetId: irtCash.id, userId: userA.id } as any).returning();
  const [bank1IrtA] = await db.insert(accounts).values({ code: "1020", name: "Bank 1 IRT A", type: "asset", assetId: irtCash.id, userId: userA.id } as any).returning();
  const [bank2IrtA] = await db.insert(accounts).values({ code: "1030", name: "Bank 2 IRT A", type: "asset", assetId: irtCash.id, userId: userA.id } as any).returning();
  const [equityA] = await db.insert(accounts).values({ code: "3010", name: "Equity A", type: "equity", assetId: usdCash.id, userId: userA.id } as any).returning();
  const [incomeA] = await db.insert(accounts).values({ code: "4010", name: "Income A", type: "income", assetId: irtCash.id, userId: userA.id } as any).returning();
  const [expenseA] = await db.insert(accounts).values({ code: "5010", name: "Expense A", type: "expense", assetId: irtCash.id, userId: userA.id } as any).returning();
  const [btcA] = await db.insert(accounts).values({ code: "1100", name: "Crypto BTC A", type: "asset", assetId: btc.id, userId: userA.id } as any).returning();
  const [pnlA] = await db.insert(accounts).values({ code: "4100", name: "Realized P&L A", type: "income", assetId: usdCash.id, userId: userA.id } as any).returning();

  return {
    usd,
    irt,
    btc,
    usdCash,
    irtCash,
    userA,
    cashUsdA,
    cashIrtA,
    bank1IrtA,
    bank2IrtA,
    equityA,
    incomeA,
    expenseA,
    btcA,
    pnlA,
  };
}

test("STAGE 7 — PWA Manifest & Service Worker Integrity: RTL, standalone display, icons, shortcuts, and zero API caching", () => {
  const manifestPath = path.resolve(process.cwd(), "public/manifest.webmanifest");
  const swPath = path.resolve(process.cwd(), "public/sw.js");

  assert.ok(fs.existsSync(manifestPath), "manifest.webmanifest exists");
  assert.ok(fs.existsSync(swPath), "sw.js exists");

  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
  assert.equal(manifest.dir, "rtl", "PWA manifest configured for RTL Persian");
  assert.equal(manifest.lang, "fa", "PWA language configured to fa");
  assert.equal(manifest.display, "standalone", "PWA display is standalone app");
  assert.ok(Array.isArray(manifest.icons) && manifest.icons.length > 0, "PWA icons configured");
  assert.ok(Array.isArray(manifest.shortcuts) && manifest.shortcuts.length >= 3, "PWA quick action shortcuts configured");
  assert.ok(manifest.icons.some((i: { purpose?: string }) => String(i.purpose).includes("maskable")));

  const swContent = fs.readFileSync(swPath, "utf-8");
  assert.ok(
    swContent.includes("req.method !== \"GET\"") || swContent.includes("No API mutations are ever cached"),
    "Service Worker strictly forbids caching API mutations",
  );
  assert.ok(swContent.includes("/api/"), "API paths are explicitly excluded from caching");
  assert.ok(swContent.includes("PURGE_CACHES"), "tenant purge remains functional");
  assert.ok(!/cache\.put\(req.*navigate/i.test(swContent), "navigations are never written to Cache Storage");
});

test("STAGE 7 — iOS install guide and offline shell remain production-ready", () => {
  const guide = fs.readFileSync(path.resolve(process.cwd(), "src/components/pwa/IosInstallGuide.tsx"), "utf-8");
  assert.ok(guide.includes("نصب وزان روی آیفون"));
  assert.ok(guide.includes("متوجه شدم"));
  assert.ok(guide.includes("aria-modal"));
  assert.ok(guide.includes("CriOS|FxiOS|EdgiOS"));

  const offline = fs.readFileSync(path.resolve(process.cwd(), "src/app/offline/page.tsx"), "utf-8");
  assert.ok(offline.includes("اطلاعات مالی شما عمداً در حافظه آفلاین ذخیره نشده است"));
  assert.ok(offline.includes("تلاش دوباره"));
});

test("STAGE 7 — UI & Accessibility Invariance: Shell, Card, and CommandPalette include required ARIA accessibility attributes", () => {
  const shellPath = path.resolve(process.cwd(), "src/components/layout/Shell.tsx");
  const cardPath = path.resolve(process.cwd(), "src/components/ui/Card.tsx");
  const cmdkPath = path.resolve(process.cwd(), "src/components/ui/CommandPalette.tsx");

  const shellCode = fs.readFileSync(shellPath, "utf-8");
  assert.ok(shellCode.includes("aria-keyshortcuts"), "Command Palette trigger has aria-keyshortcuts");
  assert.ok(shellCode.includes("aria-expanded"), "Sidebar toggle has aria-expanded");
  assert.ok(shellCode.includes("aria-live"), "Offline banner has aria-live");

  const cardCode = fs.readFileSync(cardPath, "utf-8");
  assert.ok(cardCode.includes("role=\"progressbar\""), "Progress component has role=progressbar");
  assert.ok(cardCode.includes("aria-live"), "Alert component has aria-live attribute");

  const cmdkCode = fs.readFileSync(cmdkPath, "utf-8");
  assert.ok(cmdkCode.includes("role=\"dialog\"") && cmdkCode.includes("aria-modal"), "Command Palette dialog has role=dialog aria-modal=true");
  assert.ok(cmdkCode.includes("role=\"combobox\"") && cmdkCode.includes("role=\"listbox\""), "Command Palette inputs have accessible combobox & listbox roles");
});

test("STAGE 7 — Design System Identity Preservation: Calm Ledger colors, tabular numerals, and mobile touch targets preserved", () => {
  const cssPath = path.resolve(process.cwd(), "src/app/globals.css");
  const cssCode = fs.readFileSync(cssPath, "utf-8");

  assert.ok(cssCode.includes("PWOS Design System"), "PWOS Design System identity preserved");
  assert.ok(cssCode.includes("tabular-nums"), "Tabular numerals preserved for first-class financial numbers");
  assert.ok(cssCode.includes("touch-action: manipulation"), "Mobile touch-action manipulation preserved");
  assert.ok(cssCode.includes(".interactive-card") || cssCode.includes(".card-hover"), "Tactile card hover and active feedback styling preserved");
});

test("STAGE 7 — 100% Financial & Accounting Core Invariance under UI/UX Evolution", async () => {
  const { btc, usdCash, irtCash, userA, cashUsdA, cashIrtA, bank1IrtA, bank2IrtA, equityA, incomeA, expenseA, btcA, pnlA } = await setupStage7Scenario();

  // 1. Income: 38m IRT @ 190,000 = 200 USD historical
  const inc = await recordIncome({
    entryDate: "2026-08-01",
    description: "Salary Income 38m",
    cashAccountId: cashIrtA.id,
    categoryAccountId: incomeA.id,
    assetId: irtCash.id,
    quantity: "38000000",
    baseValue: "200",
    userId: userA.id,
  });
  await db.insert(entryFxSnapshots).values({
    entryId: inc.id,
    irtAmount: "38000000",
    usdAmount: "200",
    fxRate: "190000",
    rateSource: "user",
    rateDate: "2026-08-01",
  } as any);

  // 2. Expense: 19m IRT @ 190,000 = 100 USD historical
  const exp = await recordExpense({
    entryDate: "2026-08-02",
    description: "Expense 19m",
    cashAccountId: cashIrtA.id,
    categoryAccountId: expenseA.id,
    assetId: irtCash.id,
    quantity: "19000000",
    baseValue: "100",
    userId: userA.id,
  });
  await db.insert(entryFxSnapshots).values({
    entryId: exp.id,
    irtAmount: "19000000",
    usdAmount: "100",
    fxRate: "190000",
    rateSource: "user",
    rateDate: "2026-08-02",
  } as any);

  // 3. Transfer: 20m from Bank 1 (50m) to Bank 2
  await recordIncome({
    entryDate: "2026-08-03",
    description: "Bank 1 Equity 50m",
    cashAccountId: bank1IrtA.id,
    categoryAccountId: equityA.id,
    assetId: irtCash.id,
    quantity: "50000000",
    baseValue: "263.15",
    userId: userA.id,
  });
  await recordTransfer({
    entryDate: "2026-08-03",
    description: "Transfer 20m",
    fromAccountId: bank1IrtA.id,
    toAccountId: bank2IrtA.id,
    assetId: irtCash.id,
    quantity: "20000000",
    unitPrice: "0.00000526315",
    userId: userA.id,
  });

  // 4. Asset Buy: 1 BTC @ 50,000 USD
  await recordBuy({
    entryDate: "2026-08-04",
    description: "Buy 1 BTC @ 50k",
    assetAccountId: btcA.id,
    cashAccountId: equityA.id,
    assetId: btc.id,
    quantity: "1",
    cashAssetId: usdCash.id,
    cashQuantity: "50000",
    baseValue: "50000",
    userId: userA.id,
  });

  // 5. Asset Sell: 0.5 BTC @ 60,000 USD (Proceeds = 30,000 USD, FIFO cost = 25,000 USD -> Realized P&L = +5,000 USD)
  await recordSell({
    entryDate: "2026-08-05",
    description: "Sell 0.5 BTC @ 60k",
    assetAccountId: btcA.id,
    cashAccountId: cashUsdA.id,
    pnlAccountId: pnlA.id,
    assetId: btc.id,
    quantity: "0.5",
    cashAssetId: usdCash.id,
    cashQuantity: "30000",
    baseValue: "30000",
    userId: userA.id,
  });

  // Reconcile Balances
  const balances = await getAccountBalances(userA.id);
  const b1 = balances.find((b) => b.accountId === bank1IrtA.id);
  const b2 = balances.find((b) => b.accountId === bank2IrtA.id);
  assert.equal(parseFloat(b1?.quantity || "0"), 30000000);
  assert.equal(parseFloat(b2?.quantity || "0"), 20000000);

  // Reconcile FIFO & Realized P&L
  const openLots = await getOpenLots(btc.id, userA.id);
  assert.equal(openLots.length, 1);
  assert.equal(parseFloat(openLots[0].qtyRemaining), 0.5);

  const pnl = await getRealizedPnl(userA.id);
  assert.equal(parseFloat(pnl.total), 5000, "Realized P&L = +5,000 USD invariant");

  // Reconcile Historical FX after Current FX Update
  await updateUserFxRate(userA.id, "250000");
  const [snapAfterInc] = await db.select().from(entryFxSnapshots).where(eq(entryFxSnapshots.entryId, inc.id));
  const [snapAfterExp] = await db.select().from(entryFxSnapshots).where(eq(entryFxSnapshots.entryId, exp.id));
  assert.equal(parseFloat(snapAfterInc.usdAmount), 200, "Historical USD = 200 invariant");
  assert.equal(parseFloat(snapAfterExp.usdAmount), 100, "Historical USD = 100 invariant");
  assert.equal(parseFloat(snapAfterInc.fxRate), 190000, "Historical FX = 190,000 invariant");

  // Reconcile Total Debit = Total Credit invariant
  const audit = await runStage3IntegrityAudit();
  assert.equal(audit.unbalancedJournals, 0, "Zero unbalanced journals (Total Debit = Total Credit)");
  assert.equal(audit.orphanPostings, 0, "Zero orphan postings");
  assert.equal(audit.duplicateIdempotency, 0, "Zero duplicate idempotency keys");
  assert.equal(audit.negativeLots, 0, "Zero negative lots");
  assert.equal(audit.overConsumedLots, 0, "Zero over-consumed lots");
  assert.equal(audit.ok, true, "Stage 7 final accounting core protection passes 100%");
});
