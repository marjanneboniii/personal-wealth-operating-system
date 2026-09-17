import Link from "next/link";
import { ensureAuth } from "@/lib/authGuard";
import { eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { debts, installments } from "@/db/schema";
import { seedIfEmpty } from "@/db/seed";
import { getAccountBalances, getTransactions, type TxRow } from "@/features/ledger/queries";
import { getEntryFxSnapshots } from "@/features/ledger/fxSnapshots";
import { listCategoryTree } from "@/features/categories/service";
import { PageHeader } from "@/components/ui/Card";
import Icon from "@/components/ui/Icon";
import ModuleTabs, { MONEY_TABS } from "@/components/ui/ModuleTabs";
import TransactionsView, { type ClientTxRow } from "@/components/transactions/TransactionsView";
import { getLatestUsdIrtRate } from "@/lib/fx";
import { todayIso } from "@/lib/format";

export const dynamic = "force-dynamic";

export const metadata = { title: "تراکنش‌ها" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/** Rows fetched per view. Hitting it is announced — never a silent cut-off. */
const ROW_LIMIT = 150;

function monthShift(iso: string, months: number) {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.toISOString().slice(0, 10);
}

export default async function TransactionsPage({ searchParams }: { searchParams: SearchParams }) {
  const user = await ensureAuth();
  const userId = (user as { id?: string } | null)?.id ?? undefined;
  await seedIfEmpty();
  const sp = await searchParams;
  const s = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : "");

  const q = s("q").trim();
  const type = ["income", "expense", "transfer", "buy", "sell", "adjustment", "installment", "opening", "debt", "debt_repayment", "fx"].includes(s("type")) ? s("type") : "";
  const accountId = s("account");
  const categoryId = s("category");
  const review = s("review") === "reviewed" || s("review") === "unreviewed" ? (s("review") as "reviewed" | "unreviewed") : "";
  const sort = ["new", "old", "amount"].includes(s("sort")) ? s("sort") : "new";
  const range = ["m1", "m3", "m6", "ytd", "all"].includes(s("range")) ? s("range") : "m3";

  const today = todayIso();
  const from =
    range === "m1" ? monthShift(today, -1) : range === "m3" ? monthShift(today, -3) : range === "m6" ? monthShift(today, -6) : range === "ytd" ? `${today.slice(0, 4)}-01-01` : undefined;

  const [rows, accounts, fx, categoryTree] = await Promise.all([
    getTransactions({
      limit: ROW_LIMIT,
      q: q || undefined,
      type: type || undefined,
      accountId: accountId || undefined,
      categoryId: categoryId || undefined,
      from,
      review: (review || undefined) as "reviewed" | "unreviewed" | undefined,
      sort: sort as "new" | "old" | "amount",
      userId,
    }),
    getAccountBalances(userId),
    getLatestUsdIrtRate(),
    listCategoryTree(userId),
  ]);

  // FX freeze + installment linkage for the detail panel. The ids come from the
  // tenant-scoped query above.
  const ids = rows.map((r) => r.id);
  const [fxBy, linkedRows] = await Promise.all([
    getEntryFxSnapshots(ids),
    ids.length
      ? db
          .select({ entryId: installments.paidEntryId, seq: installments.seq, title: debts.title })
          .from(installments)
          .innerJoin(debts, eq(debts.id, installments.debtId))
          .where(inArray(installments.paidEntryId, ids))
      : Promise.resolve([] as { entryId: string | null; seq: number; title: string }[]),
  ]);
  const linkedBy = new Map(linkedRows.filter((r) => r.entryId).map((r) => [r.entryId as string, r]));

  const clientRows: ClientTxRow[] = rows.map((r: TxRow) => {
    const linked = linkedBy.get(r.id);
    return {
      ...r,
      fx: fxBy.get(r.id) ?? null,
      linkedInstallment: linked ? { title: linked.title, seq: linked.seq } : null,
    };
  });

  // Account filter covers money accounts; the category filter uses the
  // hierarchical expense category tree (parent matches all of its children).
  const accountGroups = [
    {
      label: "حساب‌های پول",
      options: accounts
        .filter((a) => a.type === "asset" && a.assetId)
        .map((a) => ({ id: a.accountId, name: a.name }))
        .slice(0, 40),
    },
  ].filter((g) => g.options.length > 0);

  const categoryGroups = categoryTree.map((p) => ({
    id: p.id,
    name: p.name,
    children: p.children.map((c) => ({ id: c.id, name: c.name })),
  }));

  return (
    <div className="space-y-5">
      <div>
        <PageHeader
          title="تراکنش‌ها"
          action={
            <div className="flex flex-wrap gap-2">
              <Link href="/transactions/import" className="btn btn-ghost">ورود پیام / صورت‌حساب</Link>
              <Link href="/new" className="btn btn-primary">
                <Icon name="plus" size={16} />
                ثبت تراکنش
              </Link>
            </div>
          }
        />
        <ModuleTabs tabs={MONEY_TABS} active="/transactions" label="بخش‌های پول" />
      </div>
      <TransactionsView
        rows={clientRows}
        accountGroups={accountGroups}
        categoryGroups={categoryGroups}
        rate={String(fx.rate ?? "")}
        filters={{ q, type, accountId, categoryId, review, range, sort }}
        truncated={rows.length >= ROW_LIMIT}
      />
    </div>
  );
}
