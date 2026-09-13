import { D, Decimal } from "@/domain/decimal";

/** One month of `getCashflow` — only the fields the Toman view needs. */
export type CashflowMonthRow = {
  inflow: string;
  outflow: string;
  inflowToman: string | null;
  outflowToman: string | null;
  inflowEntries: number;
  outflowEntries: number;
  inflowEntriesSnap: number;
  outflowEntriesSnap: number;
};

export type TomanFlow = { inflow: string; outflow: string; net: string; frozen: boolean };

const covered = (m: CashflowMonthRow) =>
  m.inflowEntries === m.inflowEntriesSnap && m.outflowEntries === m.outflowEntriesSnap;

const usableRate = (rate: string | null | undefined) => (rate && D(rate).gt(0) ? rate : null);

/**
 * Income / spending / net of a window in Toman, under the FROZEN-TOMAN rule
 * (Global System Directive §1).
 *
 * The recorded Toman of a past transaction is its commit-time freeze. A window
 * is reported from those freezes only when EVERY entry in it carries one — a
 * partial cover would understate the total. Otherwise the figures are the
 * dynamic current-rate equivalent (`frozen: false`), and with no usable rate
 * there is no Toman view at all (`null`).
 *
 * The overview and the cash-flow page both read through here, so the same
 * month can never show two different Toman figures on two screens.
 */
export function windowToman(months: CashflowMonthRow[], rate: string | null | undefined): TomanFlow | null {
  const r = usableRate(rate);
  const frozen = months.length > 0 && months.every(covered);
  let inflow = Decimal.zero();
  let outflow = Decimal.zero();
  if (frozen) {
    for (const m of months) {
      inflow = inflow.add(D(m.inflowToman ?? "0"));
      outflow = outflow.add(D(m.outflowToman ?? "0"));
    }
  } else if (r) {
    for (const m of months) {
      inflow = inflow.add(D(m.inflow).mul(r));
      outflow = outflow.add(D(m.outflow).mul(r));
    }
  } else {
    return null;
  }
  return {
    inflow: inflow.toFixed(0),
    outflow: outflow.toFixed(0),
    net: inflow.sub(outflow).toFixed(0),
    frozen,
  };
}

/** The same rule for a single month. */
export function monthToman(month: CashflowMonthRow | null | undefined, rate: string | null | undefined): TomanFlow | null {
  return month ? windowToman([month], rate) : null;
}
