import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { accounts, assets, wallets } from "@/db/schema";
import { D, Decimal } from "@/domain/decimal";
import { getAccountBalances } from "@/features/ledger/queries";
import { STABLECOIN_SYMBOLS } from "@/lib/stablecoins";

/**
 * «از کدام پول‌ها خرج می‌کنید؟» — money outside the bank the user may live on:
 * a stablecoin held in a wallet or exchange, or Toman parked at an exchange or
 * broker. Bank Toman is always in the forecast; these count only when the user
 * switches them on (`accounts.spend_from`), because the same coins are often
 * held for trading instead.
 */
export type SpendSource = {
  id: string;
  name: string;
  walletName: string | null;
  symbol: string;
  decimals: number;
  logoUrl: string | null;
  quantity: string;
  /** Today's value in Toman: Toman as is, a stablecoin at the live USD rate. */
  valueToman: string;
  on: boolean;
};

const TOMAN = ["IRT", "IRR"];

export async function listSpendSources(userId: string | null | undefined, rate: string | null | undefined): Promise<SpendSource[]> {
  if (!userId) return [];
  const stables = sql.join(
    [...STABLECOIN_SYMBOLS].map((s) => sql`${s}`),
    sql`, `,
  );
  const [rows, balances] = await Promise.all([
    db
      .select({
        id: accounts.id,
        name: accounts.name,
        walletName: wallets.name,
        symbol: assets.symbol,
        decimals: assets.decimals,
        logoUrl: assets.logoUrl,
        on: accounts.spendFrom,
      })
      .from(accounts)
      .innerJoin(assets, eq(assets.id, accounts.assetId))
      .innerJoin(wallets, eq(wallets.id, accounts.walletId))
      .where(
        and(
          eq(accounts.userId, userId),
          isNull(accounts.deletedAt),
          eq(accounts.type, "asset"),
          sql`(upper(${assets.symbol}) in (${stables})
            or (upper(coalesce(${assets.symbol}, '')) in ('IRT', 'IRR') and ${wallets.kind} in ('exchange', 'broker')))`,
        ),
      )
      .orderBy(accounts.code),
    getAccountBalances(userId).catch(() => []),
  ]);
  const qty = new Map(balances.map((b) => [b.accountId, b.quantity]));
  const usd = D(rate ?? "0");
  return rows.map((r) => {
    const symbol = (r.symbol ?? "").toUpperCase();
    const q = D(qty.get(r.id) ?? "0");
    const value = symbol === "IRR" ? q.div(10) : TOMAN.includes(symbol) ? q : usd.gt(0) ? q.mul(usd) : Decimal.zero();
    return {
      id: r.id,
      name: r.name,
      walletName: r.walletName,
      symbol,
      decimals: r.decimals ?? 2,
      logoUrl: r.logoUrl,
      quantity: q.toString(),
      valueToman: (value.gt(0) ? value : Decimal.zero()).toFixed(0),
      on: r.on,
    };
  });
}

/** Σ of the switched-on sources — added to the forecast's opening cash. */
export function spendableToman(sources: SpendSource[]): string {
  return sources.reduce((sum, s) => (s.on ? sum.add(s.valueToman) : sum), Decimal.zero()).toFixed(0);
}

export async function setSpendFrom(userId: string, accountId: string, on: boolean) {
  const res = await db
    .update(accounts)
    .set({ spendFrom: on })
    .where(and(eq(accounts.id, accountId), eq(accounts.userId, userId), isNull(accounts.deletedAt)))
    .returning({ id: accounts.id });
  if (res.length === 0) throw new Error("حساب پیدا نشد.");
}
