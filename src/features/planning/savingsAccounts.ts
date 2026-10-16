import { asc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { accounts, assets, wallets } from "@/db/schema";
import { STABLECOIN_SYMBOLS } from "@/lib/stablecoins";

/**
 * Where a goal or a fund is saved — the ONE list «اهداف و صندوق‌ها» offers:
 *
 *   حساب‌های بانکی       Toman held at a bank
 *   تتر و استیبل‌کوین     a stablecoin HELD somewhere («یو اس دی جی - ربی والت»);
 *                        a bare, wallet-less stablecoin account is not a place
 *
 * Never income/expense ledger accounts, foreign cash, Toman parked at an
 * exchange or broker, or volatile assets. Only this user's live accounts.
 */
export async function listSavingsAccounts(userId: string | null | undefined) {
  const stables = sql.join(
    [...STABLECOIN_SYMBOLS].map((s) => sql`${s}`),
    sql`, `,
  );
  return db
    .select({
      id: accounts.id,
      code: accounts.code,
      name: accounts.name,
      symbol: assets.symbol,
      decimals: assets.decimals,
      logoUrl: assets.logoUrl,
      walletName: wallets.name,
      walletKind: wallets.kind,
    })
    .from(accounts)
    .innerJoin(assets, eq(assets.id, accounts.assetId))
    .innerJoin(wallets, eq(wallets.id, accounts.walletId))
    .where(
      sql`${accounts.deletedAt} is null and ${accounts.type} = 'asset'
        and (
          (${wallets.kind} = 'bank' and upper(coalesce(${assets.symbol}, '')) in ('IRT', 'IRR'))
          or upper(${assets.symbol}) in (${stables})
        )
        ${userId ? sql`and ${accounts.userId} = ${userId}` : sql``}`,
    )
    .orderBy(asc(accounts.code));
}
