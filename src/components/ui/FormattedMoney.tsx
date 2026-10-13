import type { ReactNode } from "react";
import AnimatedAmount from "@/components/landing/AnimatedAmount";

/**
 * Presentation-only split of the existing formatted amount and currency label.
 * `animate` counts the figure up once when it scrolls into view (the page's
 * headline number only); it always settles on the exact formatted string, and
 * reduced-motion visitors see the final value straight away.
 */
export default function FormattedMoney({ value, animate = false }: { value: string; animate?: boolean }): ReactNode {
  const separator = value.indexOf(" ");
  if (separator < 0) return value;
  const amount = value.slice(0, separator).replace(/[\u2066-\u2069]/g, "");
  const unit = value.slice(separator + 1).replace(/[\u2066-\u2069]/g, "");
  return (
    <>
      <span className="num-mono ltr-isolate" dir="ltr">{animate ? <AnimatedAmount value={amount} /> : amount}</span>
      <span className="money-unit">{unit}</span>
    </>
  );
}
