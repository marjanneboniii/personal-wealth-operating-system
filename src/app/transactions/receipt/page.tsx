import Link from "next/link";
import type { ReactNode } from "react";
import { ensureAuth } from "@/lib/authGuard";
import { getTransactionById } from "@/features/ledger/queries";
import { getEntryFxSnapshots } from "@/features/ledger/fxSnapshots";
import { EmptyState } from "@/components/ui/Card";
import Icon, { type IconName } from "@/components/ui/Icon";
import DateTile from "@/components/ui/DateTile";
import FormattedMoney from "@/components/ui/FormattedMoney";
import { ReceiptCode, ReceiptPrint } from "@/components/transactions/ReceiptActions";
import { humanizeEntry, plainAccountName } from "@/lib/tx";
import { amountToWords } from "@/lib/numberToWords";
import { D } from "@/domain/decimal";
import { formatJalaliIso, formatMoney, toFaDigits } from "@/lib/format";
import { iranHoliday } from "@/lib/iranHolidays";
import { getLatestUsdIrtRate } from "@/lib/fx";

export const dynamic = "force-dynamic";

export const metadata = { title: "رسید تراکنش" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const SOURCE_LABEL: Record<string, string> = { manual: "دستی", plan: "اجرا شده از برنامه", import: "درون‌ریزی" };

const TITLE_BY_TYPE: Record<string, string> = {
  expense: "هزینه ثبت شد",
  income: "درآمد ثبت شد",
  transfer: "انتقال ثبت شد",
  debt_repayment: "بازپرداخت ثبت شد",
  installment: "قسط ثبت شد",
  buy: "خرید ثبت شد",
  sell: "فروش ثبت شد",
};

type Status = "success" | "pending" | "failed";
const STATUS_ICON: Record<Status, IconName> = { success: "check", pending: "clock", failed: "x" };

/** «۰۹:۱۲» at Tehran time — the moment the entry was committed. */
function tehranTime(iso: string | null) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const t = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Tehran", hour: "2-digit", minute: "2-digit", hour12: false }).format(d);
  return toFaDigits(t);
}

/**
 * «رسید تراکنش» — one recorded entry as a payment receipt: status, the frozen
 * Toman amount and its words, who paid whom, and a tracking code to copy.
 * The Toman figure is the commit-time freeze (the same rule as the list);
 * only an entry without one shows «≈» at today's rate.
 */
export default async function ReceiptPage({ searchParams }: { searchParams: SearchParams }) {
  const user = await ensureAuth();
  const userId = (user as { id?: string } | null)?.id ?? undefined;
  const sp = await searchParams;
  const id = typeof sp.id === "string" ? sp.id : "";
  const entry = id ? await getTransactionById(id, userId) : null;

  if (!entry) {
    return (
      <div className="receipt-page">
        <div className="card">
          <EmptyState
            icon="receipt"
            title="رسیدی با این شناسه پیدا نشد"
            action={
              <Link href="/transactions" className="btn btn-soft">
                بازگشت به تراکنش‌ها
              </Link>
            }
          />
        </div>
      </div>
    );
  }

  const [fxBy, fx] = await Promise.all([getEntryFxSnapshots([entry.id]), getLatestUsdIrtRate()]);
  const snap = fxBy.get(entry.id) ?? null;
  const h = humanizeEntry(entry);
  const rate = fx.rate && D(fx.rate).gt(0) ? String(fx.rate) : null;

  const frozenToman = h.nativeIrt ?? (snap?.irtAmount && D(snap.irtAmount).gt(0) ? D(snap.irtAmount).toFixed(0) : null);
  const toman = frozenToman ?? (rate ? D(h.amountExact).mul(rate).toFixed(0) : null);
  const words = toman ? amountToWords(toman, "toman") : null;

  const status: Status = entry.status === "void" ? "failed" : entry.source === "import" && !entry.reviewed ? "pending" : "success";
  const title =
    status === "failed" ? "تراکنش ابطال شد" : status === "pending" ? "در انتظار بررسی" : (TITLE_BY_TYPE[entry.type] ?? "تراکنش ثبت شد");
  const description =
    status === "failed"
      ? "این سند با یک سند معکوس خنثی شده است و در گزارش‌ها حساب نمی‌شود."
      : status === "pending"
        ? "این تراکنش از پیامک یا فایل بانک آمده است و هنوز تأیید نشده."
        : entry.description;

  const category = entry.categoryName ? `${entry.categoryParentName ? `${entry.categoryParentName} › ` : ""}${entry.categoryName}` : null;
  const code = (entry.reference?.trim() || entry.id.slice(0, 8)).toUpperCase();
  const time = tehranTime(entry.createdAt);
  const holiday = iranHoliday(entry.entryDate);

  const rows: [string, ReactNode][] = [];
  const add = (label: string, value: ReactNode | null | undefined) => {
    if (value != null && value !== "") rows.push([label, value]);
  };
  add("نوع", h.typeLabel);
  add("از", h.from ? plainAccountName(h.from) : null);
  if (entry.type === "expense") {
    add("بابت", entry.categoryName ?? null);
    add("گروه", entry.categoryParentName ?? null);
  } else {
    add("به", h.to ? plainAccountName(h.to) : null);
    add("دسته", category);
  }
  add("مقدار", h.qtyLabel ? <span className="num" dir="rtl">{h.qtyLabel}</span> : null);
  // «·» is not used as a separator: next to Persian digits it reads as «۰».
  add(
    "تاریخ",
    <span>
      <bdi className="num" dir="ltr">
        {formatJalaliIso(entry.entryDate)}
      </bdi>
      {time && (
        <>
          {"، ساعت "}
          <bdi className="num" dir="ltr">
            {time}
          </bdi>
        </>
      )}
    </span>,
  );
  add("معادل دلاری", <FormattedMoney value={formatMoney(h.amount)} />);
  add("نرخ زمان ثبت", snap ? <FormattedMoney value={formatMoney(snap.fxRate, "IRT")} /> : null);
  add("منبع", SOURCE_LABEL[entry.source] ?? entry.source);
  add("کد پیگیری", <ReceiptCode value={code} label={code} />);

  return (
    <div className="receipt-page">
      <div className="receipt-toolbar">
        <Link href="/transactions" className="btn btn-ghost">
          <Icon name="chevronRight" size={16} />
          تراکنش‌ها
        </Link>
      </div>

      <section className="receipt" data-status={status} aria-labelledby="receipt-title">
        <header className="receipt-head">
          <span className="receipt-icon" aria-hidden="true">
            <Icon name={STATUS_ICON[status]} size={26} />
          </span>
          <h1 id="receipt-title" className="receipt-title">
            {title}
          </h1>
          {description && <p className="receipt-desc">{description}</p>}
          <p className="receipt-amount money-nowrap">
            {toman && !frozenToman && <span className="receipt-approx">≈</span>}
            <FormattedMoney value={toman ? formatMoney(toman, "IRT") : formatMoney(h.amount)} />
          </p>
          {words && <p className="receipt-words">{words}</p>}
        </header>

        <div className="receipt-body">
          <DateTile iso={entry.entryDate} size="sm" className="receipt-tile" />
          <dl className="receipt-rows">
            {rows.map(([label, value]) => (
              <div key={label} className="receipt-row">
                <dt>{label}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
        </div>

        {holiday && holiday.name !== "جمعه" && <p className="receipt-note">این روز تعطیل رسمی است: {holiday.name}</p>}
        {entry.tags.length > 0 && <p className="receipt-tags">{entry.tags.map((t) => `#${t}`).join(" ")}</p>}

        <div className="receipt-actions">
          <ReceiptPrint />
          {status !== "failed" && ["expense", "income", "transfer"].includes(entry.type) && (
            <Link href={`/new?repeat=${entry.id}`} className="btn btn-soft">
              <Icon name="refresh" size={16} />
              تکرار
            </Link>
          )}
          <Link href={`/new?type=${entry.type === "income" ? "income" : "expense"}`} className="btn btn-primary">
            <Icon name="plus" size={16} />
            ثبت تراکنش جدید
          </Link>
        </div>
      </section>
    </div>
  );
}
