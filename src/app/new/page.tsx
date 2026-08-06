import { asc, sql, eq } from "drizzle-orm";
import { db } from "@/db";
import { accounts, assets } from "@/db/schema";
import { seedIfEmpty } from "@/db/seed";
import { PageHeader } from "@/components/ui/Card";
import TransactionForm from "@/components/forms/TransactionForm";
import { todayIso } from "@/lib/format";
import { getLatestUsdIrtRate } from "@/lib/fx";
import { listDebts } from "@/features/planning/service";

export const dynamic = "force-dynamic";

type TxType = "expense" | "income" | "transfer" | "buy" | "sell";
const VALID: TxType[] = ["expense", "income", "transfer", "buy", "sell"];

export default async function NewTransactionPage({
  searchParams,
}: {
  searchParams: Promise<{ type?: string; debtId?: string; installmentId?: string; irtAmount?: string; title?: string; entryDate?: string }>;
}) {
  await seedIfEmpty();
  const params = await searchParams;
  const defaultType = VALID.includes(params.type as TxType) ? (params.type as TxType) : "expense";

  const [rows, fxSnap, debts] = await Promise.all([
    db
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
      .orderBy(asc(accounts.code)),
    getLatestUsdIrtRate(),
    listDebts(),
  ]);

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title="ثبت تراکنش" subtitle="هر ثبت یک سند دوطرفه تغییرناپذیر در دفترکل می‌سازد. پیش‌نمایش هوشمند قبل از تأیید نهایی، فقط نمایشی است." />
      <TransactionForm
        accounts={rows.map((r) => ({ ...r, decimals: r.decimals ?? 2 }))}
        debts={debts as any}
        defaultType={defaultType}
        today={todayIso()}
        initialRate={fxSnap.rate}
        initialRateDate={fxSnap.effectiveDate}
        initialRateSource={fxSnap.source}
        initialDebtId={params.debtId}
        initialInstallmentId={params.installmentId}
        initialIrtAmount={params.irtAmount}
        initialTitle={params.title}
        initialEntryDate={params.entryDate}
      />
    </div>
  );
}
