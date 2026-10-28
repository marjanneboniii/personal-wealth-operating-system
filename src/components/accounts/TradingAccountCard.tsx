"use client";
import { useActionState, useState, useTransition } from "react";
import Icon from "@/components/ui/Icon";
import { FormStatus } from "@/components/ui/FormStatus";
import FormattedMoney from "@/components/ui/FormattedMoney";
import {
  linkTradingAccountAction,
  syncTradingAccountAction,
  unlinkTradingAccountAction,
  updateTradingAccountAction,
} from "@/app/actions/trading";
import type { ActionResult } from "@/app/actions";
import { formatMoney, formatSignedMoney, toFaDigits } from "@/lib/format";

export type TradingAccountView = {
  accountId: string;
  name: string;
  place: string;
  site: string;
  logo: string | null;
  syncable: boolean;
  linked: boolean;
  accountValue: string;
  unrealizedPnl: string;
  /** account value − net deposits: everything won or lost so far */
  totalResult: string;
  netDeposited: string;
  staleDays: number | null;
  staleAfter: number;
  /** IRT per USD, for the Toman line; null without a rate */
  rate: string | null;
};

const sign = (v: string) => (Number(v) > 0 ? 1 : Number(v) < 0 ? -1 : 0);
const tone = (v: string) => (sign(v) > 0 ? "var(--positive)" : sign(v) < 0 ? "var(--negative)" : "var(--text-2)");

/**
 * One perp margin account: what it is worth, the open P&L, the result since
 * the money went in — and the two ways to keep it current: type the venue's
 * two numbers, or let a linked wallet address read them.
 */
export default function TradingAccountCard({ a }: { a: TradingAccountView }) {
  const [state, update, updating] = useActionState<ActionResult | null, FormData>(updateTradingAccountAction, null);
  const [linkState, link, linking] = useActionState<ActionResult | null, FormData>(linkTradingAccountAction, null);
  const [syncState, setSyncState] = useState<ActionResult | null>(null);
  const [syncing, startSync] = useTransition();
  const stale = a.staleDays == null || a.staleDays >= a.staleAfter;
  const toman = (usd: string) => (a.rate ? formatMoney((Number(usd) * Number(a.rate)).toFixed(0), "IRT") : null);

  return (
    <article className="card trade-card">
      <header className="trade-head">
        {a.logo ? <img src={a.logo} alt="" width={40} height={40} className="trade-logo" /> : <span className="trade-logo" aria-hidden="true" />}
        <span className="min-w-0 flex-1">
          <b className="block truncate">{a.name}</b>
          <span className="trade-site" dir="ltr">
            {a.site}
          </span>
        </span>
        <span className={`badge ${stale ? "badge-warn" : "badge-neutral"}`}>
          {a.staleDays == null ? "هنوز به‌روز نشده" : a.staleDays === 0 ? "امروز به‌روز شد" : `${stale ? "تخمینی · " : ""}${toFaDigits(String(a.staleDays))} روز پیش`}
        </span>
      </header>

      <div className="trade-value">
        <span className="trade-label">ارزش حساب</span>
        <b className="num money-nowrap" dir="rtl">
          <FormattedMoney value={formatMoney(a.accountValue)} />
        </b>
        {toman(a.accountValue) && (
          <span className="trade-sub num money-nowrap" dir="rtl">
            ≈ {toman(a.accountValue)}
          </span>
        )}
      </div>

      <dl className="trade-stats">
        <div>
          <dt>سود و زیان باز</dt>
          <dd className="num money-nowrap" dir="rtl" style={{ color: tone(a.unrealizedPnl) }}>
            <FormattedMoney value={formatSignedMoney(a.unrealizedPnl, "USD")} />
          </dd>
        </div>
        <div>
          <dt>نتیجهٔ کل از واریز</dt>
          <dd className="num money-nowrap" dir="rtl" style={{ color: tone(a.totalResult) }}>
            <FormattedMoney value={formatSignedMoney(a.totalResult, "USD")} />
          </dd>
        </div>
        <div>
          <dt>سرمایهٔ واریزی</dt>
          <dd className="num money-nowrap" dir="rtl">
            <FormattedMoney value={formatMoney(a.netDeposited)} />
          </dd>
        </div>
      </dl>
      <p className="trade-note">
        <Icon name="info" size={14} /> بیشترین زیانِ ممکن از اینجا، همین ارزش فعلی حساب است (اگر لیکویید شوید). سود و زیان باز سند حسابداری نمی‌خورد؛ فقط در
        دارایی خالص دیده می‌شود.
      </p>

      <details className="trade-panel" open={a.staleDays == null}>
        <summary>به‌روزرسانی دستی</summary>
        <form action={update} className="trade-form">
          <input type="hidden" name="accountId" value={a.accountId} />
          <p className="trade-hint">دقیقاً همان دو عددی را بنویسید که پلتفرم نشان می‌دهد. اگر پوزیشن بازی ندارید، سود و زیان باز را خالی بگذارید.</p>
          <label className="block">
            <span className="label">ارزش حساب (Account Value)</span>
            <input name="accountValue" className="field num" dir="ltr" inputMode="decimal" required placeholder="113.91" autoComplete="off" />
          </label>
          <div className="trade-pnl">
            <label className="block flex-1">
              <span className="label">سود و زیان باز (Unrealized PnL)</span>
              <input name="unrealizedPnl" className="field num" dir="ltr" inputMode="decimal" placeholder="0" autoComplete="off" />
            </label>
            <label className="block">
              <span className="label">نوع</span>
              <select name="pnlSign" className="field" defaultValue="loss">
                <option value="loss">زیان</option>
                <option value="profit">سود</option>
              </select>
            </label>
          </div>
          <button type="submit" className="btn btn-primary" disabled={updating}>
            {updating ? "در حال ثبت…" : "ثبت عددها"}
          </button>
          <FormStatus state={state} />
        </form>
      </details>

      {a.syncable && (
        <details className="trade-panel" open={a.linked}>
          <summary>به‌روزرسانی خودکار</summary>
          {a.linked ? (
            <div className="trade-form">
              <p className="trade-hint">عددها از API عمومی {a.place} با آدرس کیف پولتان خوانده می‌شوند — فقط خواندنی، بدون کلید یا امضا.</p>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={syncing}
                  onClick={() => startSync(async () => setSyncState(await syncTradingAccountAction(a.accountId)))}
                >
                  <Icon name="refresh" size={16} />
                  {syncing ? "در حال خواندن…" : "به‌روزرسانی از پلتفرم"}
                </button>
                <button
                  type="button"
                  className="btn btn-ghost"
                  disabled={syncing}
                  onClick={() => startSync(async () => setSyncState(await unlinkTradingAccountAction(a.accountId)))}
                >
                  حذف آدرس
                </button>
              </div>
              <FormStatus state={syncState} />
            </div>
          ) : (
            <form action={link} className="trade-form">
              <input type="hidden" name="accountId" value={a.accountId} />
              <p className="trade-hint">
                آدرس عمومی کیف پولی که با آن در {a.place} معامله می‌کنید. کلید خصوصی یا عبارت بازیابی را هرگز وارد نکنید — لازم نیست.
              </p>
              <label className="block">
                <span className="label">آدرس کیف پول</span>
                <input name="address" className="field num" dir="ltr" required placeholder="0x…" autoComplete="off" spellCheck={false} pattern="0x[0-9a-fA-F]{40}" />
              </label>
              <button type="submit" className="btn btn-soft" disabled={linking}>
                {linking ? "در حال خواندن…" : "ثبت آدرس و خواندن عددها"}
              </button>
              <FormStatus state={linkState} />
            </form>
          )}
        </details>
      )}
    </article>
  );
}
