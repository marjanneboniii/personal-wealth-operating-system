"use client";

/**
 * DeleteAccountButton — «حذف حساب» with a confirmation box that states the
 * consequence BEFORE anything is written.
 *
 * A user registers an account by mistake, or their bank blocks it, and they
 * want it off the money page. Deleting an account touches the ledger, so the
 * box is not a yes/no prompt: it opens by asking the server what would
 * actually happen (`previewMoneyAccountDeletionAction`) and shows the real
 * numbers — the balance at stake, how many ledger entries are attached, what
 * gets detached — before the destructive button becomes available at all.
 *
 * The preview is a DISPLAY, never an authorisation: `deleteMoneyAccountAction`
 * re-derives every check inside its own transaction, so a stale box (a
 * transaction posted while it was open) can never push a deletion through.
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  deleteMoneyAccountAction,
  previewMoneyAccountDeletionAction,
} from "@/app/actions";
import type { MoneyAccountDeletionPreview } from "@/features/accounts/service";
import Icon from "@/components/ui/Icon";
import Sheet from "@/components/ui/Sheet";
import { D } from "@/domain/decimal";
import { faCount, formatMoney } from "@/lib/format";

const KIND_LABELS: Record<string, string> = {
  bank: "حساب بانکی",
  cash: "نقد / صندوق",
  exchange: "صرافی",
  hot: "کیف پول",
  cold: "کیف پول سرد",
  fund: "صندوق / کارگزاری",
};

/** The balance in the account's own unit, as the money list writes it. */
function balanceLabel(preview: MoneyAccountDeletionPreview): string {
  const symbol = preview.symbol ?? "USD";
  const q = D(preview.quantity);
  const decimals = symbol === "IRT" || symbol === "IRR" ? 0 : Math.min(preview.assetDecimals ?? 2, 8);
  return formatMoney(q.toFixed(decimals), symbol);
}

export default function DeleteAccountButton({
  accountId,
  accountName,
  /** Compact variant for the indented rows inside a multi-account wallet. */
  compact,
}: {
  accountId: string;
  accountName: string;
  compact?: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState<MoneyAccountDeletionPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [loading, startLoad] = useTransition();
  const [deleting, startDelete] = useTransition();

  function openBox() {
    setPreview(null);
    setError(null);
    setDone(null);
    setOpen(true);
    startLoad(async () => {
      const result = await previewMoneyAccountDeletionAction(accountId);
      if (result.ok && result.preview) setPreview(result.preview);
      else setError(result.message ?? "پیش‌نمایش حذف حساب در دسترس نیست.");
    });
  }

  function confirmDelete() {
    startDelete(async () => {
      const result = await deleteMoneyAccountAction(accountId);
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setDone(result.message);
      router.refresh();
      // The row is gone after the refresh; the box closes on its own so the
      // user lands back on the list rather than on a dialog about nothing.
      setTimeout(() => setOpen(false), 1400);
    });
  }

  return (
    <>
      {/* `icon-btn` keeps the design system's 44px tap target; `-me-2` pulls the
          button into the row's own padding so the account name loses no width
          on a phone. */}
      <button
        type="button"
        className="icon-btn -me-2 shrink-0"
        aria-label={`حذف حساب ${accountName}`}
        title="حذف حساب"
        onClick={openBox}
      >
        <Icon name="trash" size={compact ? 15 : 16} />
      </button>

      <Sheet open={open} onClose={() => setOpen(false)} title="حذف حساب">
        <div className="space-y-3 p-4 text-[length:var(--fs-xs)]">
          {loading && !preview && !error && <p className="muted">در حال بررسی وابستگی‌های این حساب…</p>}

          {preview && !done && (
            <>
              <div className="soft rounded-[var(--r-lg)] p-3">
                <p className="text-[length:var(--fs-sm)] font-semibold">{preview.name}</p>
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  {preview.walletName && preview.walletName !== preview.name && (
                    <span className="chip">{preview.walletName}</span>
                  )}
                  {preview.walletKind && <span className="chip">{KIND_LABELS[preview.walletKind] ?? preview.walletKind}</span>}
                  {preview.assetName && <span className="chip">{preview.assetName}</span>}
                </div>
                <div className="mt-3 flex items-baseline justify-between gap-3">
                  <span className="muted">موجودی فعلی</span>
                  <span className="num money-nowrap font-semibold" dir="rtl">
                    {balanceLabel(preview)}
                  </span>
                </div>
              </div>

              <div className="space-y-1.5">
                <p className="font-semibold">با تأیید، چه اتفاقی می‌افتد؟</p>
                <ul className="muted list-disc space-y-1 pe-4">
                  {preview.mode === "full" ? (
                    <li>
                      تنها سند این حساب، سند افتتاحیهٔ خودش است؛ آن سند ابطال می‌شود و موجودی اولیه از دارایی خالص شما
                      کنار می‌رود.
                    </li>
                  ) : preview.entryCount > 0 ? (
                    <li>
                      {faCount(preview.entryCount)} سند دفترکل به این حساب متصل است. این اسناد حذف نمی‌شوند و
                      گزارش‌های گذشته تغییری نمی‌کنند؛ فقط حساب از فهرست حساب‌ها برداشته می‌شود.
                    </li>
                  ) : (
                    <li>این حساب هیچ سندی در دفترکل ندارد و حذف آن هیچ اثری بر گزارش‌ها نمی‌گذارد.</li>
                  )}
                  {preview.removesWallet && preview.walletName && (
                    <li>کیف/بانک «{preview.walletName}» حساب دیگری ندارد و همراه این حساب برداشته می‌شود.</li>
                  )}
                  {preview.plannedTransactions > 0 && (
                    <li>{faCount(preview.plannedTransactions)} برنامهٔ پرداخت در انتظار، متصل به این حساب، لغو می‌شود.</li>
                  )}
                  {preview.linkedGoals > 0 && (
                    <li>پیوند {faCount(preview.linkedGoals)} هدف با این حساب برداشته می‌شود (خودِ هدف باقی می‌ماند).</li>
                  )}
                  {preview.linkedFunds > 0 && (
                    <li>پیوند {faCount(preview.linkedFunds)} صندوق با این حساب برداشته می‌شود (خودِ صندوق باقی می‌ماند).</li>
                  )}
                  <li>این کار برگشت‌پذیر نیست.</li>
                </ul>
              </div>

              {preview.blockedReason && (
                <div
                  className="rounded-[var(--r-md)] border p-3"
                  style={{
                    background: "var(--negative-soft)",
                    borderColor: "color-mix(in oklab, var(--negative) 28%, transparent)",
                    color: "var(--negative)",
                  }}
                  role="alert"
                >
                  {preview.blockedReason}
                </div>
              )}
            </>
          )}

          {done && (
            <p role="status" className="font-medium" style={{ color: "var(--positive)" }}>
              {done}
            </p>
          )}

          {error && (
            <p role="alert" style={{ color: "var(--negative)" }}>
              {error}
            </p>
          )}

          {!done && (
            <div className="flex flex-wrap gap-2 pt-1">
              <button
                type="button"
                className="btn btn-danger"
                disabled={!preview?.canDelete || deleting}
                onClick={confirmDelete}
              >
                {deleting ? "در حال حذف…" : "بله، حساب حذف شود"}
              </button>
              <button type="button" className="btn btn-ghost" onClick={() => setOpen(false)} disabled={deleting}>
                انصراف
              </button>
            </div>
          )}
        </div>
      </Sheet>
    </>
  );
}
