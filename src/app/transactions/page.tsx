import Link from "next/link";
import { ensureAuth } from "@/lib/authGuard";
import { eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { debts, entryFxSnapshots, installments } from "@/db/schema";
import { seedIfEmpty } from "@/db/seed";
import { getAccountBalances, getTransactions, type TxRow } from "@/features/ledger/queries";
import { listCategoryTree } from "@/features/categories/service";
import { PageHeader } from "@/components/ui/Card";
import Icon from "@/components/ui/Icon";
import TransactionsView, { type ClientTxRow } from "@/components/transactions/TransactionsView";
import { getLatestUsdIrtRate } from "@/lib/fx";
import { todayIso } from "@/lib/format";

export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

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
      limit: 150,
      q: q || undefined,
      type: type || undefined,
      accountId: accountId || undefined,
      categoryId: categoryId || undefined,
      from,
      review: (review || undefined) as "reviewed" | "unreviewed" | undefined,
      sort: sort as "new" | "old" | "amount",
    }),
    getAccountBalances(),
    getLatestUsdIrtRate(),
    listCategoryTree(userId),
  ]);

  // Attach FX freeze + installment linkage for the detail panel
  const ids = rows.map((r) => r.id);
  const [fxRows, linkedRows] = ids.length
    ? await Promise.all([
        db.select().from(entryFxSnapshots).where(inArray(entryFxSnapshots.entryId, ids)),
        db
          .select({ entryId: installments.paidEntryId, seq: installments.seq, title: debts.title })
          .from(installments)
          .innerJoin(debts, eq(debts.id, installments.debtId))
          .where(inArray(installments.paidEntryId, ids)),
      ])
    : [[], []];
  const fxBy = new Map(fxRows.map((r) => [r.entryId, r]));
  const linkedBy = new Map(linkedRows.filter((r) => r.entryId).map((r) => [r.entryId as string, r]));

  const clientRows: ClientTxRow[] = rows.map((r: TxRow) => ({
    ...r,
    fx: fxBy.get(r.id)
      ? {
          irtAmount: fxBy.get(r.id)!.irtAmount,
          usdAmount: fxBy.get(r.id)!.usdAmount,
          fxRate: fxBy.get(r.id)!.fxRate,
          rateSource: fxBy.get(r.id)!.rateSource,
          rateDate: fxBy.get(r.id)!.rateDate,
        }
      : null,
    linkedInstallment: linkedBy.get(r.id) ? { title: linkedBy.get(r.id)!.title, seq: linkedBy.get(r.id)!.seq } : null,
  }));

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
    <div>
      <PageHeader
        title="تراکنش‌ها"
        action={
          <Link href="/new" className="btn btn-primary">
            <Icon name="plus" size={16} />
            ثبت تراکنش
          </Link>
        }
      />
      <TransactionsView
        rows={clientRows}
        accountGroups={accountGroups}
        categoryGroups={categoryGroups}
        rate={String(fx.rate ?? "")}
        filters={{ q, type, accountId, categoryId, review, range, sort }}
      />
    </div>
  );
}
