import { asc, sql } from "drizzle-orm";
import { db } from "@/db";
import { accounts, assets } from "@/db/schema";
import { eq } from "drizzle-orm";
import { seedIfEmpty } from "@/db/seed";
import { PageHeader } from "@/components/ui/Card";
import TransactionForm from "@/components/forms/TransactionForm";
import { todayIso } from "@/lib/format";

export const dynamic = "force-dynamic";

type TxType = "expense" | "income" | "transfer" | "buy" | "sell";
const VALID: TxType[] = ["expense", "income", "transfer", "buy", "sell"];

export default async function NewTransactionPage({
  searchParams,
}: {
  searchParams: Promise<{ type?: string }>;
}) {
  await seedIfEmpty();
  const { type } = await searchParams;
  const defaultType = VALID.includes(type as TxType) ? (type as TxType) : "expense";

  const rows = await db
    .select({
      id: accounts.id,
      code: accounts.code,
      name: accounts.name,
      type: accounts.type,
      symbol: assets.symbol,
      decimals: assets.decimals,
    })
    .from(accounts)
    .leftJoin(assets, eq(assets.id, accounts.assetId))
    .where(sql`${accounts.deletedAt} is null and ${accounts.assetId} is not null`)
    .orderBy(asc(accounts.code));

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title="ثبت تراکنش" subtitle="هر ثبت یک سند دوطرفه تغییرناپذیر در دفترکل می‌سازد." />
      <TransactionForm
        accounts={rows.map((r) => ({ ...r, decimals: r.decimals ?? 2 }))}
        defaultType={defaultType}
        today={todayIso()}
      />
    </div>
  );
}
