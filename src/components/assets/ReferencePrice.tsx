/**
 * A reference price on «نمای بازار» — the number, what it is for, WHEN the
 * source saw it and WHO published it, and one word when it is not live.
 *
 * Every string is derived from the stored ISO times alone (no clock read
 * here), so the server and the browser render the same text.
 */
import { formatMoney, formatJalaliIso, toFaDigits } from "@/lib/format";
import type { ReferenceQuoteView, ReferenceState } from "@/features/pricing/referencePresentation";

const TEHRAN_OFFSET_MS = 3.5 * 60 * 60 * 1000;

/** «۱۴۰۵/۰۷/۰۲ ۱۸:۱۰» in Tehran time. */
export function tehranStamp(iso: string): string {
  const shifted = new Date(new Date(iso).getTime() + TEHRAN_OFFSET_MS).toISOString();
  return `${formatJalaliIso(shifted)} ${toFaDigits(shifted.slice(11, 16))}`;
}

/** «۱۸:۱۰» — for a source that sent a clock time only; its date is not shown as fact. */
function tehranClock(iso: string): string {
  const shifted = new Date(new Date(iso).getTime() + TEHRAN_OFFSET_MS).toISOString();
  return toFaDigits(shifted.slice(11, 16));
}

/** Only these states get a word; the rest show the price and its time alone. */
const STATE_LABELS: Partial<Record<ReferenceState, string>> = {
  delayed: "با تأخیر",
  market_closed: "بازار بسته",
};

export default function ReferencePrice({ quote }: { quote: ReferenceQuoteView }) {
  const when = quote.observedAtInferred ? `ساعت ${tehranClock(quote.observedAt)} (آخرین جلسه)` : tehranStamp(quote.observedAt);
  return (
    <div className="space-y-0.5">
      <div className="num" dir="rtl">
        <b>{formatMoney(quote.amount, quote.currency)}</b>
      </div>
      <div className="muted">
        {quote.unitLabel}
        {quote.basisLabel ? ` · ${quote.basisLabel}` : ""}
      </div>
      {quote.secondary.map((s) => (
        <div key={s.label} className="muted num" dir="rtl">
          {s.label}: {formatMoney(s.amount, s.currency)}
        </div>
      ))}
      <div className="muted">
        {quote.attribution} · {when}
      </div>
      {STATE_LABELS[quote.state] && (
        <div className="chip" role="status">
          {STATE_LABELS[quote.state]}
        </div>
      )}
    </div>
  );
}
