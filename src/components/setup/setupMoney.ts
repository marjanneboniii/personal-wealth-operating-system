import { D } from "@/domain/decimal";

type Dec = ReturnType<typeof D>;

/** Currency a setup amount is typed in. USDT is booked at face (1 USDT = 1 USD). */
export type SetupCurrency = "IRT" | "USD" | "USDT";

/** A typed amount, or zero when blank or not a number yet (the field is mid-edit). */
export function amountOf(value: string | undefined): Dec {
  const text = (value ?? "").trim();
  if (!text) return D("0");
  try {
    return D(text);
  } catch {
    return D("0");
  }
}

/** quantity × unit price, or zero when either is missing. */
export function lineValue(quantity: string | undefined, unitPrice: string | undefined): Dec {
  const q = amountOf(quantity);
  const p = amountOf(unitPrice);
  return q.gt(0) && p.gt(0) ? q.mul(p) : D("0");
}

/** Toman value of an amount: Toman as is, USD/USDT × the setup rate. */
export function toToman(amount: Dec, currency: SetupCurrency, rate: string): Dec {
  if (currency === "IRT") return amount;
  const r = amountOf(rate);
  return r.gt(0) ? amount.mul(r) : D("0");
}

/** The same sanity band the server and the rate settings enforce. */
export function isValidRate(rate: string): boolean {
  const r = amountOf(rate);
  return r.gte(1000) && r.lte(10_000_000);
}

export const newRowKey = () => Math.random().toString(36).slice(2);
