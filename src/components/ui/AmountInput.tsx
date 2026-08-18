"use client";

/**
 * AmountInput — shared, reusable money field with a real-time
 * "amount in words" hint rendered directly under the input.
 *
 * Used by every form across the app (transactions, debts, budgets, accounts,
 * assets, registry, setup wizard, …) so the behaviour is identical everywhere:
 *   • words update instantly while the user types (no button, no submit);
 *   • the hint is small, muted and non-intrusive (empty/invalid/zero → hidden);
 *   • the unit follows the field's own currency (تومان for IRT fields, …);
 *   • the read-only saved views are untouched — the hint only exists while the
 *     input itself is rendered (i.e. in edit mode).
 *
 * Works as a controlled input (value + onChange) or an uncontrolled one
 * (name + defaultValue), so it drops into existing server-action forms
 * without changing how values are submitted.
 */

import * as React from "react";
import { amountToWords, type AmountUnitKey } from "@/lib/numberToWords";

export type AmountInputProps = Omit<
  React.InputHTMLAttributes<HTMLInputElement>,
  "value" | "defaultValue" | "onChange"
> & {
  /** Controlled value. */
  value?: string | number;
  /** Uncontrolled default value. */
  defaultValue?: string | number;
  onChange?: React.ChangeEventHandler<HTMLInputElement>;
  /**
   * Currency unit appended to the words hint. Accepts a currency key
   * ("toman" | "rial" | "usd" | "eur" | "usdt") or a free-form label
   * (e.g. "تتر"). Pass "none" (or leave unset for a numeric-only field) to
   * omit the unit.
   */
  unit?: AmountUnitKey | string;
  /** Show the words hint (default true). Set false for non-money fields. */
  showWords?: boolean;
  /** Extra class for the words hint line. */
  hintClassName?: string;
};

/**
 * The hint line itself — exported separately so callers can also place it
 * next to a hand-rolled input if ever needed.
 */
export function AmountWords({
  value,
  unit,
  className,
}: {
  value: string | number | bigint | null | undefined;
  unit?: AmountUnitKey | string;
  className?: string;
}) {
  const label = amountToWords(value, unit === "none" ? undefined : unit);
  if (!label) return null;
  return (
    <p className={`amount-words ${className ?? ""}`} dir="rtl" aria-live="polite">
      {label}
    </p>
  );
}

export default function AmountInput({
  value,
  defaultValue,
  onChange,
  unit = "toman",
  showWords = true,
  className,
  hintClassName,
  type = "text",
  inputMode = "numeric",
  ...rest
}: AmountInputProps) {
  const isControlled = value !== undefined;
  const [live, setLive] = React.useState<string>(defaultValue == null ? "" : String(defaultValue));

  // Controlled inputs read the parent value directly; uncontrolled inputs
  // mirror the DOM value so the words stay live without touching the form.
  const current = isControlled ? String(value ?? "") : live;

  const handleChange: React.ChangeEventHandler<HTMLInputElement> = (event) => {
    if (!isControlled) setLive(event.target.value);
    onChange?.(event);
  };

  return (
    <span className="block min-w-0">
      <input
        {...rest}
        type={type}
        inputMode={inputMode}
        value={isControlled ? value : undefined}
        defaultValue={isControlled ? undefined : defaultValue}
        onChange={handleChange}
        className={className}
      />
      {showWords ? <AmountWords value={current} unit={unit} className={hintClassName} /> : null}
    </span>
  );
}
