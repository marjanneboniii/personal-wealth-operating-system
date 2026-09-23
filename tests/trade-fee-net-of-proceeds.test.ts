/**
 * A trade fee moves the settlement account by exactly the fee typed.
 *
 * Reproduces a real entry: 109 USDT sold at بیت‌پین for 228,790 Toman each
 * (24,938,110 Toman) with a 138,110-Toman fee. Only 24,800,000 Toman arrived,
 * but the ledger credited the full 24,938,110 and reported the fee as 139,262:
 * the fee was converted to dollars at the dollar rate (226,897) and read back
 * at the Tether rate (228,790), and it never left any balance.
 *
 *  • a sale deposits proceeds − fee; a purchase withdraws value + fee
 *  • the fee is booked in the unit it was paid in, and reports read it back exactly
 *  • a fee as large as the proceeds is refused
 *  • a lot-based sale (ETH for USDT) nets the fee exactly too
 */
import assert from "node:assert/strict";
import { test, mock } from "node:test";
import { eq, sql } from "drizzle-orm";
import { D, Decimal } from "../src/domain/decimal";
import { accounts, assetClasses, assets, journalEntries, postings, users, userFxSettings, wallets, wallexAssetCatalog } from "../src/db/schema";

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

const TODAY = new Date().toISOString().slice(0, 10);

test("trade fees: net proceeds, exact Toman, both directions", async () => {
  const { db } = await import("../src/db");
  const { createSchemaIfNotExists } = await import("../src/db/init-schema");
  const { createSession } = await import("../src/lib/auth");
  const { createTransactionAction } = await import("../src/app/actions");
  const { postEntry } = await import("../src/features/ledger/service");
  const { getAccountBalances, getCashflow } = await import("../src/features/ledger/queries");
  await createSchemaIfNotExists();

  const [user] = await db.insert(users).values({ name: "Seller", username: `seller-${Date.now()}`, role: "owner" } as any).returning();
  // The dollar rate and the Tether price differ, exactly as on the real day.
  await db.insert(userFxSettings).values({ userId: user.id, currentRate: "226897" } as any);
  await db.insert(wallexAssetCatalog).values({ symbol: "USDT", displayName: "تتر", latinName: "Tether", kind: "stablecoin", priceTmn: "228790", priceUsdt: "1" } as any);
  const cls = async (code: string, name: string) => (await db.insert(assetClasses).values({ code, name } as any).returning())[0];
  const cash = await cls("cash", "نقد و بانک");
  const stable = await cls("stable", "استیبل‌کوین");
  const crypto = await cls("crypto", "رمزارز");
  const asset = async (symbol: string, classId: string, decimals: number) => (await db.insert(assets).values({ symbol, name: symbol, classId, decimals } as any).returning())[0];
  await asset("USD", cash.id, 2);
  const irt = await asset("IRT", cash.id, 0);
  const usdt = await asset("USDT", stable.id, 6);
  const eth = await asset("ETH", crypto.id, 8);
  const [bitpin] = await db.insert(wallets).values({ userId: user.id, name: "بیت‌پین", kind: "exchange" } as any).returning();
  const acc = async (code: string, name: string, type: string, assetId: string, walletId: string | null = null) =>
    (await db.insert(accounts).values({ code, name, type, assetId, walletId, userId: user.id } as any).returning())[0];
  const toman = await acc("1610", "تومان - بیت‌پین", "asset", irt.id, bitpin.id);
  const tether = await acc("1200", "تتر - بیت‌پین", "asset", usdt.id, bitpin.id);
  const ether = await acc("1210", "اتریوم - بیت‌پین", "asset", eth.id, bitpin.id);
  const equity = await acc("3010", "سرمایه افتتاحیه", "equity", irt.id);
  await postEntry({
    entryDate: TODAY, type: "opening", description: "افتتاحیه", userId: user.id,
    postings: [
      { accountId: tether.id, assetId: usdt.id, quantity: "1000", baseValue: "1000" },
      { accountId: toman.id, assetId: irt.id, quantity: "50000000", baseValue: "220.36" },
      { accountId: equity.id, assetId: irt.id, quantity: "-50000000", baseValue: "-1220.36" },
    ],
  });
  cookieJar.value = (await createSession(user.id)).token;

  const qty = async (id: string) => D((await getAccountBalances(user.id)).find((b: any) => b.accountId === id)?.quantity ?? "0");
  const trade = (f: Record<string, string>) => {
    const fd = new FormData();
    for (const [k, v] of Object.entries({ entryDate: TODAY, feeMode: "irt", priceMode: "limit", ...f })) fd.set(k, v);
    return createTransactionAction(null, fd);
  };
  const balanced = async () =>
    D(((await db.execute(sql`select coalesce(sum(base_value), 0)::text as s from postings`)).rows[0] as any).s).abs().lt("0.000001");

  // ── The real sale ──
  const sale = await trade({ type: "sell", description: "فروش ۱۰۹ تتر", primaryAccountId: tether.id, counterAccountId: toman.id, quantity: "109", unitPrice: "228790", settleQuantity: "24938110", irtAmount: "24938110", fee: "138110" });
  assert.equal(sale.ok, true, sale.message);
  assert.equal((await qty(toman.id)).toString(), "74800000", "50,000,000 + the 24,800,000 that actually arrived");
  assert.equal((await qty(tether.id)).toString(), "891", "exactly 109 USDT left");
  const [entry] = await db.select().from(journalEntries).where(eq(journalEntries.description, "فروش ۱۰۹ تتر"));
  const feeLeg = (await db.select().from(postings).where(eq(postings.entryId, entry.id))).find((p: any) => p.memo === "کارمزد تبدیل ارز");
  assert.equal(feeLeg?.assetId, irt.id, "a Toman fee is booked as Toman");
  assert.equal(D(feeLeg!.quantity).toString(), "138110");
  const flow = await getCashflow(1, user.id);
  assert.equal(Decimal.sum(flow.map((m: any) => m.outflowToman ?? "0")).toFixed(0), "138110", "the report reads back the fee typed — not 139,262");
  assert.ok(await balanced());

  // ── A purchase withdraws value + fee ──
  const buy = await trade({ type: "buy", description: "خرید ۱۰۰ تتر", primaryAccountId: tether.id, counterAccountId: toman.id, quantity: "100", unitPrice: "228790", settleQuantity: "22879000", irtAmount: "22879000", fee: "50000" });
  assert.equal(buy.ok, true, buy.message);
  assert.equal((await qty(toman.id)).toString(), "51871000", "74,800,000 − 22,879,000 − 50,000");
  assert.equal((await qty(tether.id)).toString(), "991");
  const flow2 = await getCashflow(1, user.id);
  assert.equal(Decimal.sum(flow2.map((m: any) => m.outflowToman ?? "0")).toFixed(0), "188110", "138,110 + 50,000");
  assert.ok(await balanced());

  // ── A fee as large as the proceeds is refused, and nothing is written ──
  const before = (await db.select().from(journalEntries)).length;
  const tooBig = await trade({ type: "sell", description: "رد شود", primaryAccountId: tether.id, counterAccountId: toman.id, quantity: "1", unitPrice: "228790", settleQuantity: "228790", irtAmount: "228790", fee: "228790" });
  assert.equal(tooBig.ok, false);
  assert.equal((await db.select().from(journalEntries)).length, before);

  // ── A lot-based sale nets a fee typed in its settlement unit (USDT) exactly ──
  const ethBuy = await trade({ type: "buy", description: "خرید اتریوم", primaryAccountId: ether.id, counterAccountId: tether.id, quantity: "0.2", unitPrice: "3000", settleQuantity: "600", irtAmount: "137274000" });
  assert.equal(ethBuy.ok, true, ethBuy.message);
  const ethSell = await trade({ type: "sell", description: "فروش اتریوم", primaryAccountId: ether.id, counterAccountId: tether.id, quantity: "0.1", unitPrice: "3200", settleQuantity: "320", irtAmount: "73212800", fee: "1.5", feeMode: "native" });
  assert.equal(ethSell.ok, true, ethSell.message);
  assert.equal((await qty(tether.id)).toString(), "709.5", "991 − 600 + 320 − 1.5");
  assert.ok(await balanced());
});

test("recordFx: a fee paid by the source leaves it in its own unit", async () => {
  const { db } = await import("../src/db");
  const { recordFx } = await import("../src/features/ledger/service");
  const [cash] = await db.select().from(assetClasses).limit(1);
  const [irt] = await db.select().from(assets).where(eq(assets.symbol, "IRT"));
  const irr = (await db.insert(assets).values({ symbol: "IRR", name: "ریال", classId: cash.id, decimals: 0 } as any).returning())[0];
  const [u] = await db.select().from(users).limit(1);
  const rial = (await db.insert(accounts).values({ code: "1011", name: "بانک ریالی", type: "asset", assetId: irr.id, userId: u.id } as any).returning())[0];
  const tomanBank = (await db.insert(accounts).values({ code: "1012", name: "بانک تومانی", type: "asset", assetId: irt.id, userId: u.id } as any).returning())[0];
  const feeAcc = (await db.insert(accounts).values({ code: "5041", name: "کارمزد", type: "expense", assetId: irr.id, userId: u.id } as any).returning())[0];
  const entry = await recordFx({
    entryDate: TODAY, description: "ریال به تومان", userId: u.id,
    fromAccountId: rial.id, toAccountId: tomanBank.id, fromAssetId: irr.id, toAssetId: irt.id,
    fromQuantity: "10000000", toQuantity: "1000000", bookValue: "4.4",
    feeBase: "0.022", feeQuantity: "50000", feePaidBy: "from", feeAccountId: feeAcc.id,
  });
  const legs = await db.select().from(postings).where(eq(postings.entryId, entry.id));
  const leg = (id: string) => legs.find((p: any) => p.accountId === id)!;
  assert.equal(D(leg(rial.id).quantity).toString(), "-10050000", "10,000,000 Rial + a 50,000-Rial fee leave the source");
  assert.equal(D(leg(tomanBank.id).quantity).toString(), "1000000", "the destination receives the full amount");
  assert.equal(D(leg(feeAcc.id).quantity).toString(), "50000");
  assert.ok(Decimal.sum(legs.map((p: any) => p.baseValue)).abs().lt("0.000001"), "balanced");
});
