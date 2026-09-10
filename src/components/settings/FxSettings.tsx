/**
 * Reference-rate panel — DISPLAY ONLY.
 *
 * Manual entry was removed by owner decision: the rate now comes from the live
 * USDT/Toman market (see features/fx/liveRate.ts). Nothing here can write a
 * rate, so a typo or a stale hand-entered number can no longer drive every
 * Toman figure in the app.
 */
import { formatMoney, formatDualDate } from "@/lib/format";
import Icon from "@/components/ui/Icon";

type Props = {
  currentRate: string;
  lastUpdatedAt: string | null;
  /** Which source answered: the live market, or the last stored value. */
  source?: string;
};

const SOURCE_LABEL: Record<string, string> = {
  market: "بازار زنده",
  wallex: "بازار زنده",
  bitpin: "بازار زنده",
  user_settings: "آخرین نرخ ذخیره‌شده",
  default: "نرخ پیش‌فرض",
};

export default function FxSettings({ currentRate, lastUpdatedAt, source = "market" }: Props) {
  const live = source === "market" || source === "wallex" || source === "bitpin";

  return (
    <div className="card p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-[length:var(--fs-md)] font-bold">نرخ مرجع تتر</h3>
          <p className="muted mt-1 text-[length:var(--fs-xs)] leading-6">
            همه‌ی ارقام تومانی اپ با این نرخ محاسبه می‌شود.
          </p>
        </div>
        <span className={`badge ${live ? "badge-pos" : "badge-warn"}`}>
          {SOURCE_LABEL[source] ?? "نامشخص"}
        </span>
      </div>

      <div className="mt-4 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="money-hero text-[length:var(--fs-2xl)] font-bold money-nowrap" dir="rtl">
          {formatMoney(currentRate, "IRT")}
        </span>
        <span className="muted text-[length:var(--fs-xs)]">به ازای هر تتر</span>
      </div>

      {lastUpdatedAt && (
        <p className="muted mt-2 flex items-center gap-1.5 text-[length:var(--fs-xs)]">
          <Icon name="clock" size={14} />
          آخرین به‌روزرسانی: {formatDualDate(lastUpdatedAt)}
        </p>
      )}

      {!live && (
        <p
          className="mt-3 rounded-[var(--r-md)] px-3 py-2 text-[length:var(--fs-xs)] leading-6"
          style={{ background: "var(--warning-soft)", color: "var(--warning)" }}
          role="status"
        >
          دسترسی به بازار برقرار نشد؛ آخرین نرخ معتبر نمایش داده می‌شود. ارقام شما دست‌نخورده باقی می‌ماند.
        </p>
      )}
    </div>
  );
}
