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

const tone = (v: string) => (Number(v) > 0 ? "var(--positive)" : Number(v) < 0 ? "var(--negative)" : "var(--text-2)");

/**
 * One perp margin account, compact: name and value, three small figures, and
 * two actions — type the venue's two numbers, or read them from the venue.
 * The form opens in place only when asked for.
 */
export default function TradingAccountCard({ a }: { a: TradingAccountView }) {
  const [panel, setPanel] = useState<"none" | "update" | "link">("none");
  const [state, update, updating] = useActionState<ActionResult | null, FormData>(updateTradingAccountAction, null);
  const [linkState, link, linking] = useActionState<ActionResult | null, FormData>(linkTradingAccountAction, null);
  const [syncState, setSyncState] = useState<ActionResult | null>(null);
  const [syncing, startSync] = useTransition();
  const stale = a.staleDays == null || a.staleDays >= a.staleAfter;
  const toman = a.rate ? formatMoney((Number(a.accountValue) * Number(a.rate)).toFixed(0), "IRT") : null;
  const sync = () => startSync(async () => setSyncState(await syncTradingAccountAction(a.accountId)));

  return (
    <article className="card trade-card">
      <header className="trade-head">
        {a.logo ? (
          /* A local 96px logo; next/image adds nothing for it. */
          /* eslint-disable-next-line @next/next/no-img-element */
          <img src={a.logo} alt="" width={32} height={32} className="trade-logo" />
        ) : (
          <span className="trade-logo" aria-hidden="true" />
        )}
        <span className="trade-name">
          <b className="truncate">{a.place}</b>
          <span className="trade-age" data-stale={stale || undefined}>
            {a.staleDays == null ? "به‌روز نشده" : a.staleDays === 0 ? "امروز" : `${toFaDigits(String(a.staleDays))} روز پیش`}
          </span>
        </span>
        <span className="trade-value">
          <b className="num money-nowrap" dir="rtl">
            <FormattedMoney value={formatMoney(a.accountValue)} />
          </b>
          {toman && (
            <span className="num money-nowrap" dir="rtl">
              ≈ {toman}
            </span>
          )}
        </span>
      </header>

      <dl className="trade-stats">
        <div>
          <dt>باز</dt>
          <dd className="num money-nowrap" dir="rtl" style={{ color: tone(a.unrealizedPnl) }}>
            <FormattedMoney value={formatSignedMoney(a.unrealizedPnl, "USD")} />
          </dd>
        </div>
        <div>
          <dt>نتیجهٔ کل</dt>
          <dd className="num money-nowrap" dir="rtl" style={{ color: tone(a.totalResult) }}>
            <FormattedMoney value={formatSignedMoney(a.totalResult, "USD")} />
          </dd>
        </div>
        <div>
          <dt>واریزی</dt>
          <dd className="num money-nowrap" dir="rtl">
            <FormattedMoney value={formatMoney(a.netDeposited)} />
          </dd>
        </div>
      </dl>

      <div className="trade-actions">
        <button type="button" className="btn btn-soft" aria-expanded={panel === "update"} onClick={() => setPanel(panel === "update" ? "none" : "update")}>
          <Icon name="note" size={15} />
          به‌روزرسانی
        </button>
        {a.syncable &&
          (a.linked ? (
            <button type="button" className="btn btn-ghost" disabled={syncing} onClick={sync}>
              <Icon name="refresh" size={15} />
              {syncing ? "…" : "خواندن از پلتفرم"}
            </button>
          ) : (
            <button type="button" className="btn btn-ghost" aria-expanded={panel === "link"} onClick={() => setPanel(panel === "link" ? "none" : "link")}>
              <Icon name="link" size={15} />
              اتصال کیف پول
            </button>
          ))}
      </div>
      <FormStatus state={syncState} />

      {panel === "update" && (
        <form action={update} className="trade-form">
          <input type="hidden" name="accountId" value={a.accountId} />
          <input name="accountValue" className="field num" dir="ltr" inputMode="decimal" required placeholder="ارزش حساب" aria-label="ارزش حساب (Account Value)" autoComplete="off" />
          <span className="trade-pnl">
            <input name="unrealizedPnl" className="field num" dir="ltr" inputMode="decimal" placeholder="سود و زیان باز" aria-label="سود و زیان باز (Unrealized PnL)" autoComplete="off" />
            <select name="pnlSign" className="field" defaultValue="loss" aria-label="سود یا زیان">
              <option value="loss">زیان</option>
              <option value="profit">سود</option>
            </select>
          </span>
          <button type="submit" className="btn btn-primary" disabled={updating}>
            {updating ? "…" : "ثبت"}
          </button>
          <FormStatus state={state} />
        </form>
      )}

      {panel === "link" && (
        <form action={link} className="trade-form">
          <input type="hidden" name="accountId" value={a.accountId} />
          <input name="address" className="field num" dir="ltr" required placeholder="0x…" aria-label="آدرس عمومی کیف پول" autoComplete="off" spellCheck={false} pattern="0x[0-9a-fA-F]{40}" />
          <button type="submit" className="btn btn-primary" disabled={linking}>
            {linking ? "…" : "اتصال"}
          </button>
          <FormStatus state={linkState} />
        </form>
      )}

      {a.linked && (
        <button
          type="button"
          className="trade-unlink"
          disabled={syncing}
          onClick={() => startSync(async () => setSyncState(await unlinkTradingAccountAction(a.accountId)))}
        >
          حذف اتصال کیف پول
        </button>
      )}
    </article>
  );
}
