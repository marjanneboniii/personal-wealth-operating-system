/**
 * The paying account of a property or vehicle purchase: a Toman account at a
 * bank, owned by this tenant. Anything else — a cash box, a Tether wallet,
 * another tenant's row — is refused before a single posting is written.
 */
import { and, eq, isNull } from "drizzle-orm";
import { accounts, assets, wallets } from "@/db/schema";
import { isTomanBankAccount } from "./rules";

export type TomanBankAccount = { id: string; assetId: string; symbol: string; name: string };

export async function requireTomanBankAccount(
  client: any,
  accountId: string,
  userId: string | null | undefined,
): Promise<TomanBankAccount> {
  const [row] = await client
    .select({
      id: accounts.id,
      type: accounts.type,
      userId: accounts.userId,
      assetId: accounts.assetId,
      name: accounts.name,
      symbol: assets.symbol,
      walletKind: wallets.kind,
    })
    .from(accounts)
    .leftJoin(assets, eq(assets.id, accounts.assetId))
    .leftJoin(wallets, eq(wallets.id, accounts.walletId))
    .where(and(eq(accounts.id, accountId), isNull(accounts.deletedAt)))
    .limit(1);
  if (!row || row.type !== "asset" || !row.assetId || (userId && row.userId !== userId)) {
    throw new Error("حساب بانکی انتخاب‌شده معتبر نیست.");
  }
  if (!isTomanBankAccount(row)) throw new Error("پرداخت فقط از حساب بانکی تومانی انجام می‌شود.");
  return { id: row.id, assetId: row.assetId, symbol: (row.symbol ?? "IRT").toUpperCase(), name: row.name };
}

/** Toman amount → the native quantity of a Toman account (a Rial account carries ten times it). */
export const tomanToNative = (toman: string, symbol: string) => (symbol === "IRR" ? String(BigInt(toman) * 10n) : toman);
