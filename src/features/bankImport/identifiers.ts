import { and, asc, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { accounts, assets, bankSmsIdentifiers, wallets } from "@/db/schema";
import { isTomanBankAccount } from "@/features/trade/rules";

/**
 * The accounts a bank SMS can belong to: the user's active Toman accounts
 * held AT A BANK. Toman at an exchange (بیت‌پین، نوبیتکس…), the cash box,
 * and Tether or crypto wallets never receive bank messages, so they are not
 * offered — and the server refuses them (isSmsBankAccount).
 */
export async function listSmsBankAccounts(userId: string, client: any = db): Promise<{ id: string; name: string }[]> {
 const rows = await client
  .select({ id: accounts.id, name: accounts.name, code: accounts.code, symbol: assets.symbol, walletKind: wallets.kind, walletName: wallets.name })
  .from(accounts)
  .innerJoin(assets, eq(assets.id, accounts.assetId))
  .leftJoin(wallets, eq(wallets.id, accounts.walletId))
  .where(and(eq(accounts.userId, userId), eq(accounts.type, "asset"), eq(accounts.isActive, true), eq(assets.symbol, "IRT"), isNull(accounts.deletedAt), isNull(assets.deletedAt)))
  .orderBy(asc(accounts.name));
 return rows.filter((r: any) => isTomanBankAccount(r)).map((r: any) => ({ id: r.id, name: r.name }));
}

/** Every active Toman account of the user — where a transfer from the bank may land. */
export async function listTomanAccounts(userId: string): Promise<{ id: string; name: string }[]> {
 return db
  .select({ id: accounts.id, name: accounts.name })
  .from(accounts)
  .innerJoin(assets, eq(assets.id, accounts.assetId))
  .where(and(eq(accounts.userId, userId), eq(accounts.type, "asset"), eq(accounts.isActive, true), eq(assets.symbol, "IRT"), isNull(accounts.deletedAt), isNull(assets.deletedAt)))
  .orderBy(asc(accounts.name));
}

export async function isSmsBankAccount(userId: string, accountId: string, client: any = db): Promise<boolean> {
 return (await listSmsBankAccounts(userId, client)).some((a) => a.id === accountId);
}

export async function listBankIdentifiers(userId: string) {
 return db.select({ id: bankSmsIdentifiers.id, accountId: accounts.id, accountName: accounts.name, bankName: bankSmsIdentifiers.bankName, kind: bankSmsIdentifiers.kind, suffix: bankSmsIdentifiers.suffix }).from(bankSmsIdentifiers)
  .innerJoin(accounts, eq(accounts.id, bankSmsIdentifiers.accountId)).innerJoin(assets, eq(assets.id, accounts.assetId))
  .where(and(eq(bankSmsIdentifiers.userId, userId), eq(accounts.userId, userId), eq(accounts.type, "asset"), eq(accounts.isActive, true), eq(assets.symbol, "IRT"), isNull(accounts.deletedAt), isNull(assets.deletedAt)));
}
