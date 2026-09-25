/**
 * A reference price on «نمای بازار» — the number, what it is for, and one
 * word when it is not live.
 *
 * Deliberately NOT shown here, though the view carries them: the provider
 * credit and the source's time («BrsAPI · ۱۴۰۵/۰۷/۰۲ ۱۶:۵۹»), the closing
 * price beside the last one («قیمت پایانی»), and the unit/basis line of Tehran
 * shares, funds and oil («هر سهم · آخرین معامله», «هر بشکه · …») — for those
 * the unit is self-evident and the line was noise in a long list.
 */
import { formatMoney } from "@/lib/format";
import type { ReferenceQuoteView, ReferenceState } from "@/features/pricing/referencePresentation";

/** Only these states get a word; the rest show the price alone. */
const STATE_LABELS: Partial<Record<ReferenceState, string>> = {
  delayed: "با تأخیر",
  market_closed: "بازار بسته",
};

/** Units whose line is not shown: a share, a fund unit, a barrel. */
const SILENT_UNITS = new Set(["هر سهم", "هر واحد صندوق", "هر بشکه"]);

export default function ReferencePrice({ quote }: { quote: ReferenceQuoteView }) {
  return (
    <div className="space-y-0.5">
      <div className="num" dir="rtl">
        <b>{formatMoney(quote.amount, quote.currency)}</b>
      </div>
      {!SILENT_UNITS.has(quote.unitLabel) && (
        <div className="muted">
          {quote.unitLabel}
          {quote.basisLabel ? ` · ${quote.basisLabel}` : ""}
        </div>
      )}
      {STATE_LABELS[quote.state] && (
        <div className="chip" role="status">
          {STATE_LABELS[quote.state]}
        </div>
      )}
    </div>
  );
}
