import { and, asc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { ensureAuth } from "@/lib/authGuard";
import { db } from "@/db";
import { accounts, assetClasses, assets, wallets } from "@/db/schema";
import { seedIfEmpty } from "@/db/seed";
import { PageHeader } from "@/components/ui/Card";
import TransactionForm from "@/components/forms/TransactionForm";
import { todayIso } from "@/lib/format";
import { getLatestUsdIrtRate } from "@/lib/fx";
import { listDebts } from "@/features/planning/service";
import { ensureCategoryCatalog, listCategoryTree } from "@/features/categories/service";
import { getAccountBalances, getExpenseHabits } from "@/features/ledger/queries";
import { listRealEstateAssets } from "@/features/rwa/realEstate/service";
import { listUserVehicles } from "@/features/rwa/vehicle/service";
import { ensureCryptoNetworks, getCryptoNetworks } from "@/features/trade/networkSync";
import { getUserOccupations } from "@/features/preferences/service";
import { suggestedIncomeCodes } from "@/features/income/occupations";
import { getIncomePlan } from "@/features/income/service";
import { getPremiumPlan } from "@/features/insurance/service";
import { entryPrefill, getTemplate } from "@/features/templates/service";
import { vehicleTagOptions } from "@/features/vehicles/service";
import { propertyTagOptions } from "@/features/properties/service";
import { listTags } from "@/features/tags/service";
import { getPendingCheque } from "@/features/cheques/service";
import { D } from "@/domain/decimal";

export const dynamic = "force-dynamic";

type TxType = "expense" | "income" | "transfer" | "buy" | "sell" | "debt_repayment";
const VALID: TxType[] = ["expense", "income", "transfer", "buy", "sell", "debt_repayment"];

export default async function NewTransactionPage({
  searchParams,
}: {
  searchParams: Promise<{ type?: string; debtId?: string; installmentId?: string; irtAmount?: string; title?: string; entryDate?: string; planId?: string; chequeId?: string; accountId?: string; repeat?: string; template?: string; tags?: string }>;
}) {
  const user = await ensureAuth();
  const userId = (user as { id?: string } | null)?.id ?? null;
  await seedIfEmpty();
  const params = await searchParams;
  const requestedType = VALID.includes(params.type as TxType) ? (params.type as TxType) : "expense";

  const sharedAccountingCodes = [
    "3000", "3010", "3200", "4000", "4010", "4100", "4900",
    "5000", "5010", "5020", "5030", "5040", "5050", "5900", "5960",
  ];
  // The page no longer waits on any price catalogue: the asset picker loads
  // the market list itself, once, in the browser. Waiting here on an upstream
  // price refresh is what made «ثبت تراکنش» slow to open.
  // Coin networks refresh in the background (at most daily); the page reads what is stored now.
  void ensureCryptoNetworks();
  const [rows, fxSnap, debts, categoryTree, balances, properties, vehicles, assetNetworks, incomeTree, occupations, incomePlan, premiumPlan, expenseHabits, tagCounts, cheque] = await Promise.all([
    db
      .select({
        id: accounts.id,
        code: accounts.code,
        name: accounts.name,
        type: accounts.type,
        symbol: assets.symbol,
        decimals: assets.decimals,
        logoUrl: assets.logoUrl,
        coingeckoId: assets.coingeckoId,
        // Liquid vs Investment hints — the form uses them to keep investment
        // positions out of the daily income/expense payment lists (F-11).
        classCode: assetClasses.code,
        className: assetClasses.name,
        walletKind: wallets.kind,
        // Where the account is held (بیت‌پین، ربی والت…) — decides where it can trade.
        walletName: wallets.name,
      })
      .from(accounts)
      .leftJoin(assets, eq(assets.id, accounts.assetId))
      .leftJoin(assetClasses, eq(assetClasses.id, assets.classId))
      .leftJoin(wallets, eq(wallets.id, accounts.walletId))
      .where(and(
        sql`${accounts.deletedAt} is null and ${accounts.assetId} is not null`,
        userId
          ? or(
              eq(accounts.userId, userId),
              and(isNull(accounts.userId), inArray(accounts.code, sharedAccountingCodes)),
            )
          : sql`1=1`,
      ))
      .orderBy(asc(accounts.code)),
    getLatestUsdIrtRate(),
    listDebts(userId ?? undefined),
    ensureCategoryCatalog().then(() => listCategoryTree(userId ?? undefined)),
    // Holdings, so buy / sell shows what the user owns and caps a sale at it.
    getAccountBalances(userId ?? undefined),
    // Registry assets the user owns — sellable from «فروش دارایی».
    userId ? listRealEstateAssets(userId) : Promise.resolve([]),
    userId ? listUserVehicles(userId) : Promise.resolve([]),
    getCryptoNetworks(),
    ensureCategoryCatalog().then(() => listCategoryTree(userId ?? undefined, "income")),
    getUserOccupations(userId),
    userId && params.planId && /^[0-9a-f-]{36}$/i.test(params.planId) ? getIncomePlan(params.planId, userId) : Promise.resolve(null),
    userId && params.planId && /^[0-9a-f-]{36}$/i.test(params.planId) ? getPremiumPlan(params.planId, userId) : Promise.resolve(null),
    // Recent categories and the last paying account — the expense form pre-selects from them.
    userId ? getExpenseHabits(userId) : Promise.resolve({ categoryIds: [], lastAccountId: null }),
    listTags(userId ?? undefined),
    userId && params.chequeId && /^[0-9a-f-]{36}$/i.test(params.chequeId) ? getPendingCheque(userId, params.chequeId) : Promise.resolve(null),
  ]);
  const incomePlanParent = incomePlan ? incomeTree.find((p) => p.children.some((c) => c.id === incomePlan.categoryId)) : undefined;
  // A premium reminder decides the form: an expense in its insurance category,
  // or a transfer into a life policy's savings account.
  const premiumParent = premiumPlan?.categoryId ? categoryTree.find((p) => p.children.some((c) => c.id === premiumPlan.categoryId)) : undefined;
  // «تکرار» of a past entry, or a saved shortcut — both only pre-fill the form.
  const isId = (v?: string) => !!v && /^[0-9a-f-]{36}$/i.test(v);
  const source =
    premiumPlan || !userId
      ? null
      : isId(params.template)
        ? await getTemplate(userId, params.template!)
        : isId(params.repeat)
          ? await entryPrefill(userId, params.repeat!)
          : null;
  const sourceParent = source?.categoryId
    ? (source.type === "income" ? incomeTree : categoryTree).find((p) => p.children.some((c) => c.id === source.categoryId))
    : undefined;
  const assetTags = userId
    ? [
        ...(await vehicleTagOptions(userId).catch(() => [])).map((v) => ({ ...v, kind: "vehicle" as const })),
        ...(await propertyTagOptions(userId).catch(() => [])).map((p) => ({ ...p, kind: "property" as const })),
      ]
    : [];
  const defaultType: TxType = premiumPlan ? (premiumPlan.savingsAccountId ? "transfer" : "expense") : source ? source.type : requestedType;

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title="ثبت تراکنش" subtitle="پول از کجا آمده و به کجا رفته را ثبت کنید. پیش‌نمایش قبل از تأیید فقط نمایشی است." />
      <TransactionForm
        accounts={rows.map((r) => ({ ...r, decimals: r.decimals ?? 2 }))}
        balances={Object.fromEntries(balances.map((b) => [b.accountId, b.quantity]))}
        assetNetworks={assetNetworks}
        incomeCategories={incomeTree.map((p) => ({
          id: p.id,
          code: p.code,
          name: p.name,
          description: p.description,
          children: p.children.map((c) => ({ id: c.id, code: c.code, name: c.name, nature: c.nature, description: c.description })),
        }))}
        incomeSuggestions={suggestedIncomeCodes(occupations)}
        initialIncome={
          incomePlan && incomePlanParent
            ? {
                planId: incomePlan.id,
                categoryId: incomePlan.categoryId,
                parentId: incomePlanParent.id,
                accountId: incomePlan.accountId,
                amount: D(incomePlan.amountNative).toString(),
              }
            : null
        }
        registryAssets={[
          ...properties.map((p) => ({
            kind: "property" as const,
            id: p.id,
            label: p.label,
            detail: [p.propertyTypeNameFa ?? p.propertyType, p.neighborhoodNameFa ?? p.area, p.cityNameFa].filter(Boolean).join(" · "),
            valueToman: p.currentValueToman,
          })),
          ...vehicles
            .filter((v) => v.status !== "sold")
            .map((v) => ({
              kind: "vehicle" as const,
              id: v.id,
              label: v.label ?? "خودرو",
              detail: `${v.brand} ${v.model} ${v.year}`,
              valueToman: null,
            })),
        ]}
        categories={categoryTree.map((p) => ({
          id: p.id,
          code: p.code,
          name: p.name,
          children: p.children.map((c) => ({
            id: c.id,
            code: c.code,
            name: c.name,
            nature: c.nature,
            description: c.description,
          })),
        }))}
        expenseRecentCategoryIds={expenseHabits.categoryIds}
        tagSuggestions={tagCounts.map((t) => t.tag)}
        lastExpenseAccountId={expenseHabits.lastAccountId}
        debts={debts as any}
        defaultType={defaultType}
        today={todayIso()}
        initialRate={fxSnap.rate}
        initialRateDate={fxSnap.effectiveDate}
        initialRateSource={fxSnap.source}
        initialDebtId={params.debtId}
        initialInstallmentId={params.installmentId}
        initialIrtAmount={params.irtAmount ?? (cheque ? D(cheque.amountToman).toFixed(0) : premiumPlan ? premiumPlan.premiumToman : (source?.amountToman ?? undefined))}
        initialTitle={params.title ?? (cheque ? `پاس شدن چک ${cheque.direction === "issued" ? "به" : "از"} ${cheque.counterparty}` : premiumPlan ? `حق بیمه «${premiumPlan.title}»` : source?.description)}
        prefill={
          premiumPlan
            ? {
                planId: premiumPlan.id,
                categoryId: premiumParent ? premiumPlan.categoryId : null,
                parentId: premiumParent?.id ?? null,
                toAccountId: premiumPlan.savingsAccountId,
              }
            : params.tags && !source
              ? { categoryId: null, parentId: null, toAccountId: null, tags: params.tags.slice(0, 200) }
              : source
              ? {
                  categoryId: sourceParent ? source.categoryId : null,
                  parentId: sourceParent?.id ?? null,
                  toAccountId: source.counterAccountId,
                  tags: source.tags,
                }
              : null
        }
        assetTags={assetTags}
        cheque={
          cheque
            ? { id: cheque.id, direction: cheque.direction, counterparty: cheque.counterparty, amountToman: D(cheque.amountToman).toFixed(0), accountId: cheque.accountId }
            : null
        }
        initialEntryDate={params.entryDate}
        initialAccountId={premiumPlan?.payAccountId ?? source?.accountId ?? (params.accountId && /^[0-9a-f-]{36}$/i.test(params.accountId) ? params.accountId : undefined)}
      />
    </div>
  );
}
