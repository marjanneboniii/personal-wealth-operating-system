import type { ReactNode } from "react";

/** Presentation-only split of the existing formatted amount and currency label. */
export default function FormattedMoney({ value }: { value: string }): ReactNode {
  const separator = value.indexOf("\u00a0");
  if (separator < 0) return value;
  const amount = value.slice(0, separator).replace(/[\u2066-\u2069]/g, "");
  const unit = value.slice(separator + 1).replace(/[\u2066-\u2069]/g, "");
  return (
    <>
      <span className="num-mono ltr-isolate" dir="ltr">{amount}</span>
      <span className="money-unit">{unit}</span>
    </>
  );
}
