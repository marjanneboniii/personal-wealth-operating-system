import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { accounts, assets, bankSmsIdentifiers } from "@/db/schema";

export async function listBankIdentifiers(userId: string) {
 return db.select({ id: bankSmsIdentifiers.id, accountId: accounts.id, accountName: accounts.name, bankName: bankSmsIdentifiers.bankName, kind: bankSmsIdentifiers.kind, suffix: bankSmsIdentifiers.suffix }).from(bankSmsIdentifiers)
  .innerJoin(accounts, eq(accounts.id, bankSmsIdentifiers.accountId)).innerJoin(assets, eq(assets.id, accounts.assetId))
  .where(and(eq(bankSmsIdentifiers.userId, userId), eq(accounts.userId, userId), eq(accounts.type, "asset"), eq(accounts.isActive, true), eq(assets.symbol, "IRT"), isNull(accounts.deletedAt), isNull(assets.deletedAt)));
}
