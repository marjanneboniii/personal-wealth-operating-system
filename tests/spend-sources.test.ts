/**
 * «از کدام پول‌ها خرج می‌کنید؟» — the forecast counts a stablecoin or
 * exchange-Toman account only once the user switches it on.
 *
 *  • candidates: a stablecoin held somewhere, Toman at an exchange — not bank
 *    Toman (always counted), not a bare stablecoin, not crypto
 *  • switching one on raises the forecast's opening cash by its Toman value
 *  • another tenant cannot switch it
 */
import assert from "node:assert/strict";
import { test, mock } from "node:test";
import { accounts, assetClasses, assets, journalEntries, postings, users, userFxSettings, wallets } from "../src/db/schema";

mock.module("next/cache", { namedExports: { revalidatePath: () => {} } });

test("spend sources: candidates, forecast and tenant isolation", async () => {
  const { db } = await import("../src/db");
  const { eq } = await import("drizzle-orm");
  const { createSchemaIfNotExists } = await import("../src/db/init-schema");
  const { projectCashflow } = await import("../src/features/planning/service");
  const s = await import("../src/features/planning/spendSources");
  await createSchemaIfNotExists();

  const tag = Math.random().toString(36).slice(2, 7);
  const mk = async (name: string) => {
    const [u] = await db.insert(users).values({ name, username: `${name}-${tag}`, role: "user" } as any).returning();
    await db.insert(userFxSettings).values({ userId: u.id, currentRate: "100000" } as any);
    return u;
  };
  const owner = await mk("spender");
  const other = await mk("stranger");

  const [cls] = await db.insert(assetClasses).values({ code: `liq-${tag}`, name: "نقد" } as any).returning();
  const asset = async (symbol: string) => {
    const [found] = await db.select().from(assets).where(eq(assets.symbol, symbol)).limit(1);
    if (found) return found;
    const [row] = await db.insert(assets).values({ symbol, name: symbol, classId: cls.id, decimals: 2 } as any).returning();
    return row;
  };
  const usdt = await asset("USDT");
  const irt = await asset("IRT");
  const btc = await asset("BTC");
  const [exchange] = await db.insert(wallets).values({ userId: owner.id, name: `صرافی ${tag}`, kind: "exchange" } as any).returning();
  const [bankW] = await db.insert(wallets).values({ userId: owner.id, name: `بانک ${tag}`, kind: "bank" } as any).returning();

  const acct = async (code: string, name: string, assetId: string, walletId: string | null) => {
    const [a] = await db.insert(accounts).values({ userId: owner.id, code, name, type: "asset", assetId, walletId } as any).returning();
    return a;
  };
  const tether = await acct("1100", "تتر - صرافی", usdt.id, exchange.id);
  const exToman = await acct("1101", "تومان - صرافی", irt.id, exchange.id);
  await acct("1102", "تتر", usdt.id, null); // bare — not a place
  await acct("1103", "بیت‌کوین - صرافی", btc.id, exchange.id); // crypto — never
  await acct("1010", "بانک سامان", irt.id, bankW.id); // bank — always counted, not a switch

  // 50 USDT in the exchange.
  const [je] = await db.insert(journalEntries).values({ entryDate: "2026-01-01", type: "transfer", description: "seed", status: "posted", userId: owner.id } as any).returning();
  await db.insert(postings).values({ entryId: je.id, accountId: tether.id, assetId: usdt.id, quantity: "50", baseValue: "50" } as any);

  const sources = await s.listSpendSources(owner.id, "100000");
  assert.deepEqual(sources.map((x) => x.id).sort(), [tether.id, exToman.id].sort(), "only wallet stablecoins and exchange Toman are offered");
  assert.equal(sources.find((x) => x.id === tether.id)!.valueToman, "5000000", "50 USDT × 100,000");
  assert.equal(s.spendableToman(sources), "0", "nothing counts until switched on");

  const opening = async () => Number((await projectCashflow(3, "base", owner.id)).startingLiquidityToman);
  const before = await opening();
  await assert.rejects(() => s.setSpendFrom(other.id, tether.id, true), "another tenant cannot switch it");
  await s.setSpendFrom(owner.id, tether.id, true);
  assert.equal((await opening()) - before, 5_000_000, "switched on, the tether joins the opening cash");
  await s.setSpendFrom(owner.id, tether.id, false);
  assert.equal(await opening(), before, "switched off, it leaves again");
});
