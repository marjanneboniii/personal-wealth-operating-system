import assert from "node:assert/strict";
import { test } from "node:test";
import { db } from "../src/db";
import { createSchemaIfNotExists } from "../src/db/init-schema";
import {
  accounts,
  exchangeRates,
  journalEntries,
  lotConsumptions,
  lots,
  postings,
  settings,
  userFxSettings,
  userSetupState,
  users,
  wallets,
} from "../src/db/schema";
import { completeSetup } from "../src/features/setup/service";
import {
  canonicalWalletName,
  holdingAccountName,
  holdingKeyOf,
  KNOWN_WALLETS,
  walletKeyOf,
  walletKindOf,
  walletLogoFor,
} from "../src/features/setup/holdingWallets";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

async function setupFreshDb() {
  await createSchemaIfNotExists();
  await db.delete(lotConsumptions);
  await db.delete(lots);
  await db.delete(postings);
  await db.delete(journalEntries);
  await db.delete(userSetupState);
  await db.delete(userFxSettings);
  await db.delete(exchangeRates);
  await db.delete(settings);
  await db.delete(accounts);
  await db.delete(wallets);
  await db.delete(users);
}

const base = {
  userName: "کاربر",
  baseCurrency: "USD",
  displayCurrency: "IRT",
  dateCalendar: "jalali" as const,
  digitStyle: "fa" as const,
  bankAccountName: "بانک ملت",
  fxRate: "100000",
};

test("place names fold spacing, case, ZWNJ and Arabic letters", () => {
  assert.equal(walletKeyOf("  Trust   Wallet "), walletKeyOf("trust wallet"));
  assert.equal(walletKeyOf("بیت‌پین"), walletKeyOf("بیت پین"));
  assert.equal(walletKeyOf("كيف"), walletKeyOf("کیف"));
  assert.notEqual(holdingKeyOf("USDT", "نوبیتکس"), holdingKeyOf("USDT", "Ledger"));
  assert.equal(walletKindOf("نوبیتکس"), "exchange");
  assert.equal(walletKindOf("Binance"), "exchange");
  assert.equal(walletKindOf("Ledger"), "cold");
  assert.equal(walletKindOf("SafePal"), "hot");
});

test("known wallets are stored under their Persian name, with a local logo on disk", () => {
  assert.equal(canonicalWalletName("MetaMask"), "متامسک");
  assert.equal(canonicalWalletName("rabby wallet"), "ربی والت");
  assert.equal(canonicalWalletName("OKX Wallet"), "او‌کی‌ایکس والت");
  assert.equal(canonicalWalletName("coinbase wallet"), "کوین‌بیس والت");
  assert.equal(canonicalWalletName("phantom"), "فانتوم");
  assert.equal(canonicalWalletName("آبان تتر"), "آبان‌تتر");
  assert.equal(canonicalWalletName("بیت پین"), "بیت‌پین");
  assert.equal(canonicalWalletName("  SafePal  "), "SafePal", "an unknown place keeps the user's spelling");
  assert.equal(canonicalWalletName("Safe"), "سیف");
  assert.equal(canonicalWalletName("gnosis safe"), "سیف");
  assert.equal(canonicalWalletName("LBANK"), "ال‌بانک");
  assert.equal(canonicalWalletName("Bitunix"), "بیت‌یونیکس");
  assert.equal(walletKindOf("lbank"), "exchange");
  assert.equal(walletKindOf("bitunix"), "exchange");
  assert.equal(holdingAccountName("اتنا یو‌اس‌دی‌ای", "safe"), "اتنا یو‌اس‌دی‌ای - سیف");
  assert.equal(holdingAccountName("تتر", "Safe"), "تتر - سیف");
  assert.equal(holdingAccountName("یو اس دی سی", "ledger"), "یو اس دی سی - لجر");
  assert.equal(holdingAccountName("تتر", ""), "تتر");
  for (const w of KNOWN_WALLETS.filter((k) => k.logo)) {
    assert.ok(existsSync(fileURLToPath(new URL(`../public${w.logo}`, import.meta.url))), `${w.name} logo file exists`);
  }
  assert.equal(walletLogoFor("Trust Wallet"), "/icons/wallets/trust.png");
});

test("stablecoins held in the same place share one wallet; another place gets its own", async () => {
  await setupFreshDb();
  await completeSetup({
    ...base,
    cryptoHoldings: [
      { symbol: "USDT", quantity: "100", unitPrice: "1", priceCurrency: "USD", walletName: "نوبیتکس" },
      { symbol: "USDC", quantity: "50", unitPrice: "1", priceCurrency: "USD", walletName: " نوبیتکس " },
      { symbol: "USDE", quantity: "20", unitPrice: "1", priceCurrency: "USD", walletName: "Ledger" },
      { symbol: "USDT", quantity: "5", unitPrice: "1", priceCurrency: "USD", walletName: "لجر" },
      { symbol: "USDS", quantity: "7", unitPrice: "1", priceCurrency: "USD" },
    ],
  });

  const ws = await db.select().from(wallets);
  assert.equal(ws.length, 2, "two distinct places («Ledger» and «لجر» are one) → two wallets");
  const nobitex = ws.find((w) => w.name === "نوبیتکس");
  const ledger = ws.find((w) => w.name === "لجر");
  assert.equal(nobitex?.kind, "exchange");
  assert.equal(ledger?.kind, "cold");

  const coins = (await db.select().from(accounts)).filter((a) => Number(a.code) >= 1200 && Number(a.code) < 1300);
  assert.equal(coins.length, 5, "one account per coin per place");
  assert.equal(coins.filter((a) => a.walletId === nobitex?.id).length, 2);
  assert.equal(coins.filter((a) => a.walletId === ledger?.id).length, 2);
  assert.ok(coins.every((a) => !a.name.startsWith("کیف پول")), "a coin account is never named as a wallet");
  const unplaced = coins.filter((a) => a.walletId == null);
  assert.equal(unplaced.length, 1, "a coin without a place has no wallet container");
  // Every placed coin reads «<ارز> - <محل>», for every stablecoin — not only USDT.
  const names = coins.map((a) => a.name);
  assert.ok(names.includes("تتر - نوبیتکس"));
  assert.ok(names.includes("تتر - لجر"));
  assert.ok(names.some((n) => n.endsWith(" - نوبیتکس") && !n.startsWith("تتر")), "USDC is named with its place too");
  assert.ok(names.some((n) => n.endsWith(" - لجر") && !n.startsWith("تتر")), "USDe is named with its place too");
  assert.equal(unplaced[0].name.includes(" - "), false, "no place ⇒ just the coin name");
});

test("the same coin twice in the same place is refused, not silently dropped", async () => {
  await setupFreshDb();
  await assert.rejects(
    completeSetup({
      ...base,
      cryptoHoldings: [
        { symbol: "USDT", quantity: "1", unitPrice: "1", walletName: "Trust Wallet" },
        { symbol: "USDT", quantity: "2", unitPrice: "1", walletName: "trust  wallet" },
      ],
    }),
    /دو بار/,
  );
});
