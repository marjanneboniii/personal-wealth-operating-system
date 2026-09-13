"use client";

/**
 * AmountInput — the one numeric field of the app, with a live «amount in
 * words» hint under it.
 *
 * Used by every form (transactions, debts, budgets, accounts, assets,
 * registry, setup wizard, …) so typing a number behaves identically
 * everywhere:
 *   • Persian, Arabic-Indic and Latin digits are all accepted, mixed freely;
 *   • the field shows the number grouped with Persian digits — ۱٬۰۰۰٬۰۰۰ —
 *     and keeps the caret after the digit just typed;
 *   • the form and every `onChange` handler receive the CANONICAL value
 *     (Latin digits, no separators), so no server action and no accounting
 *     path ever sees the display format;
 *   • the words hint updates instantly, in the field's own unit.
 *
 * Works controlled (value + onChange) or uncontrolled (name + defaultValue).
 * When a `name` is given, the canonical value is submitted through a hidden
 * input of that name; the visible input carries no name, so a grouped string
 * can never be posted by mistake.
 *
 * `inputMode="decimal"` allows a fractional part; anything else is an integer
 * field. Rules live in `@/lib/numericInput`.
 */

import * as React from "react";
import { amountToWords, type AmountUnitKey } from "@/lib/numberToWords";
import {
  caretAfterSignificant,
  formatNumericInput,
  normalizeNumericInput,
  significantBefore,
} from "@/lib/numericInput";

export type AmountInputProps = Omit<
  React.InputHTMLAttributes<HTMLInputElement>,
  "value" | "defaultValue" | "onChange" | "type"
> & {
  /** Controlled value (canonical or not — it is normalised for display). */
  value?: string | number;
  /** Uncontrolled default value. */
  defaultValue?: string | number;
  /**
   * Receives an event whose `target.value` is the CANONICAL value, so existing
   * handlers like `(e) => setX(e.target.value)` keep working unchanged.
   */
  onChange?: React.ChangeEventHandler<HTMLInputElement>;
  /** Canonical-value callback, for new code that does not want an event. */
  onValueChange?: (value: string) => void;
  /**
   * Currency unit appended to the words hint. Accepts a currency key
   * ("toman" | "rial" | "usd" | "eur" | "usdt") or a free-form label
   * (e.g. "تتر"). Pass "none" to omit the unit.
   */
  unit?: AmountUnitKey | string;
  /** Show the words hint (default true). Set false for non-money fields. */
  showWords?: boolean;
  /** Cap on fractional digits for decimal fields. */
  maxDecimals?: number;
  /** Group thousands (default true). Off for years, floors and counts. */
  grouping?: boolean;
  /** Extra class for the words hint line. */
  hintClassName?: string;
  /** Kept for call-site compatibility; the field is always a text input. */
  type?: string;
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
  onValueChange,
  unit = "toman",
  showWords = true,
  maxDecimals,
  grouping = true,
  className,
  hintClassName,
  type: _type,
  inputMode = "numeric",
  name,
  dir = "ltr",
  ...rest
}: AmountInputProps) {
  const decimal = inputMode === "decimal";
  const normalise = React.useCallback(
    (input: unknown) => normalizeNumericInput(input, { decimal, maxDecimals }),
    [decimal, maxDecimals],
  );

  const isControlled = value !== undefined;
  const [live, setLive] = React.useState<string>(() => normalise(defaultValue));
  const canonical = isControlled ? normalise(value) : live;
  const display = formatNumericInput(canonical, "fa", grouping);

  const inputRef = React.useRef<HTMLInputElement>(null);
  /** Value-carrying characters before the caret at the last keystroke. */
  const pendingCaret = React.useRef<number | null>(null);

  // Put the caret back after the same digit once the grouped text re-renders.
  React.useLayoutEffect(() => {
    const el = inputRef.current;
    if (pendingCaret.current === null || !el || document.activeElement !== el) return;
    const pos = caretAfterSignificant(display, pendingCaret.current);
    pendingCaret.current = null;
    el.setSelectionRange(pos, pos);
  }, [display]);

  const handleChange: React.ChangeEventHandler<HTMLInputElement> = (event) => {
    const typed = event.target.value;
    pendingCaret.current = significantBefore(typed, event.target.selectionStart ?? typed.length);
    const next = normalise(typed);
    if (!isControlled) setLive(next);
    onValueChange?.(next);
    if (onChange) {
      // Hand the canonical value to handlers written as `e.target.value`.
      const target = { value: next, name: name ?? "" } as unknown as EventTarget & HTMLInputElement;
      onChange({ ...event, target, currentTarget: target });
    }
  };

  return (
    <span className="block min-w-0">
      <input
        {...rest}
        ref={inputRef}
        type="text"
        inputMode={decimal ? "decimal" : "numeric"}
        dir={dir}
        autoComplete="off"
        value={display}
        onChange={handleChange}
        className={className}
      />
      {name ? <input type="hidden" name={name} value={canonical} /> : null}
      {showWords ? <AmountWords value={canonical} unit={unit} className={hintClassName} /> : null}
    </span>
  );
}
