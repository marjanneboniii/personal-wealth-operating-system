import { listBankIdentifiers } from "@/features/bankImport/identifiers";
import BankIdentifiers from "@/components/transactions/BankIdentifiers";
import Link from "next/link";
import { listSmsConnections, listSmsDrafts } from "@/features/bankImport/sms";
import IphoneSmsConnection from "@/components/transactions/IphoneSmsConnection";
import { and, asc, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { accounts, assets } from "@/db/schema";
import { ensureAuth } from "@/lib/authGuard";
import { getLatestUsdIrtRateForUser } from "@/lib/fx";
import { formatJalaliIso, jalaliToIso, todayIso } from "@/lib/format";
import { getTransactions } from "@/features/ledger/queries";
import { listCategoryTree } from "@/features/categories/service";
import { summarizeBankHabits } from "@/features/bankImport/insights";
import { PageHeader } from "@/components/ui/Card";
import BankImportWorkspace from "@/components/transactions/BankImportWorkspace";

export const dynamic = "force-dynamic";
export const metadata = { title: "اتصال پیامک" };

export default async function BankImportPage() {
  const user = await ensureAuth();
  const [moneyAccounts, expenseTree, incomeTree, history, rate, connections, smsDrafts, identifiers] = await Promise.all([
    db.select({ id: accounts.id, name: accounts.name }).from(accounts)
      .innerJoin(assets, eq(accounts.assetId, assets.id))
      .where(and(eq(accounts.userId, user.id), eq(accounts.type, "asset"), eq(accounts.isActive, true), eq(assets.symbol, "IRT"), isNull(accounts.deletedAt), isNull(assets.deletedAt)))
      .orderBy(asc(accounts.name)),
    listCategoryTree(user.id, "expense"),
    listCategoryTree(user.id, "income"),
    getTransactions({ userId: user.id, limit: 500, sort: "new", review: "reviewed" }),
    getLatestUsdIrtRateForUser(user.id),
    listSmsConnections(user.id),
    listSmsDrafts(user.id),
    listBankIdentifiers(user.id),
  ]);
  const today = todayIso();
  const [year, month] = formatJalaliIso(today, "en").split("/").map(Number);
  const monthStart = jalaliToIso(year, month, 1);
  const habits = summarizeBankHabits(history.filter((r) => r.entryDate >= monthStart && r.entryDate <= today));
  const categories = (tree: typeof expenseTree) => tree.map((g) => ({ id: g.id, name: g.name, children: g.children.filter((c) => c.nature !== "non_cash").map((c) => ({ id: c.id, name: c.name })) })).filter((g) => g.children.length);
  let endpoint: string | null = null;
  try { const url = new URL(process.env.NEXT_PUBLIC_SITE_URL || ""); if (url.protocol === "https:") endpoint = new URL("/api/bank-messages", url.origin).href; } catch {}
  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <PageHeader title="اتصال پیامک" subtitle="بانک و کارت را معرفی کنید، آیفون را وصل کنید و پیام‌های جدید را با تأیید خودتان ثبت کنید." action={<Link href="/transactions" className="btn btn-ghost">تراکنش‌ها</Link>} />
      <div className="sms-flow" aria-label="مراحل اتصال"><span>۱ · بانک و کارت</span><span>۲ · اتصال آیفون</span><span>۳ · بررسی پیام‌ها</span></div>
      <BankIdentifiers accounts={moneyAccounts} identifiers={identifiers} />
      <IphoneSmsConnection endpoint={endpoint} connections={connections.map((c) => ({ ...c, createdAt: c.createdAt.toISOString(), lastReceivedAt: c.lastReceivedAt?.toISOString() ?? null }))} />
      <BankImportWorkspace smsDrafts={smsDrafts} accounts={moneyAccounts} expenseCategories={categories(expenseTree)} incomeCategories={categories(incomeTree)} history={history.map((r) => ({ entryDate: r.entryDate, type: r.type, status: r.status, reviewed: r.reviewed, description: r.description, categoryId: r.categoryId, categoryNonCash: r.categoryNonCash, fxIrtAmount: r.fxIrtAmount }))} habits={habits} historyLimited={history.length >= 500} rate={String(rate.rate)} rateDate={rate.effectiveDate} />
    </div>
  );
}
