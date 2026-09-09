"use client";

import { useEffect, useLayoutEffect, useRef } from "react";

/**
 * Count-up ticker for the public landing preview.
 *
 * PRESENTATION ONLY. It never derives, rounds or reformats a real financial
 * value: it receives one already-formatted string and its ONLY contract is to
 * end on that exact string again.
 *
 * Rules honoured:
 *   • The numeral system of the input is preserved — Persian digits stay
 *     Persian, Latin digits stay Latin. Nothing is converted either way.
 *   • The original grouping separator (٬ / ,) and decimal mark are reused, so
 *     every intermediate frame is formatted like the final value.
 *   • The prefix/suffix (currency label, spaces) is carried through untouched.
 *   • The final frame is assigned from the original string verbatim, so even a
 *     rounding edge case cannot alter the displayed value.
 *   • Server HTML renders the final string, so there is no hydration mismatch
 *     and no-JS / reduced-motion visitors simply see the value.
 *   • A hidden ghost copy reserves the final width, so counting can never move
 *     the layout.
 */

const LATIN_ZERO = 0x30;
const PERSIAN_ZERO = 0x06f0;
const ARABIC_ZERO = 0x0660;

const DIGITS = "0-9۰-۹٠-٩";
const GROUPS = "٬,،  '";
const DECIMALS = ".٫";
const NUMERIC_RUN = new RegExp(`[${DIGITS}][${DIGITS}${GROUPS}${DECIMALS}]*[${DIGITS}]|[${DIGITS}]`);

function zeroOf(ch: string): number | null {
  const c = ch.codePointAt(0)!;
  if (c >= LATIN_ZERO && c <= LATIN_ZERO + 9) return LATIN_ZERO;
  if (c >= PERSIAN_ZERO && c <= PERSIAN_ZERO + 9) return PERSIAN_ZERO;
  if (c >= ARABIC_ZERO && c <= ARABIC_ZERO + 9) return ARABIC_ZERO;
  return null;
}

type Parsed = {
  prefix: string;
  suffix: string;
  value: number;
  zero: number;
  group: string | null;
  decimal: string | null;
  fractionDigits: number;
};

function parse(text: string): Parsed | null {
  const match = NUMERIC_RUN.exec(text);
  if (!match) return null;

  const run = match[0];
  const zero = zeroOf(run[0]);
  if (zero === null) return null;

  let integer = "";
  let fraction = "";
  let group: string | null = null;
  let decimal: string | null = null;
  let afterDecimal = false;

  for (const ch of run) {
    const z = zeroOf(ch);
    if (z !== null) {
      const digit = String(ch.codePointAt(0)! - z);
      if (afterDecimal) fraction += digit;
      else integer += digit;
    } else if (DECIMALS.includes(ch)) {
      // A second decimal mark would mean this is not a plain number.
      if (afterDecimal) return null;
      afterDecimal = true;
      decimal = ch;
    } else {
      group = ch;
    }
  }

  const value = Number(fraction ? `${integer}.${fraction}` : integer);
  if (!Number.isFinite(value)) return null;

  return {
    prefix: text.slice(0, match.index),
    suffix: text.slice(match.index + run.length),
    value,
    zero,
    group,
    decimal,
    fractionDigits: fraction.length,
  };
}

function render(parsed: Parsed, current: number): string {
  const fixed = Math.max(0, current).toFixed(parsed.fractionDigits);
  const [rawInteger, rawFraction] = fixed.split(".");

  const grouped = parsed.group
    ? rawInteger.replace(/\B(?=(\d{3})+(?!\d))/g, parsed.group)
    : rawInteger;

  const body = rawFraction ? `${grouped}${parsed.decimal ?? "."}${rawFraction}` : grouped;

  // Map back into the numeral system of the original string.
  const localised =
    parsed.zero === LATIN_ZERO
      ? body
      : body.replace(/[0-9]/g, (d) => String.fromCodePoint(parsed.zero + (d.charCodeAt(0) - LATIN_ZERO)));

  return `${parsed.prefix}${localised}${parsed.suffix}`;
}

const DURATION = 1000;
/** If the element never intersects (hidden tab, unusual viewport) the value is
 *  still resolved, so the accessible text is never stuck at zero. */
const FALLBACK_DELAY = 1400;

export default function AnimatedAmount({ value, className }: { value: string; className?: string }) {
  const liveRef = useRef<HTMLSpanElement>(null);
  const parsedRef = useRef<Parsed | null>(null);

  // Decide before paint whether this instance animates, so the count-up never
  // shows the final value first and then jumps back to zero.
  useLayoutEffect(() => {
    const node = liveRef.current;
    if (!node) return;

    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const parsed = reduceMotion || typeof IntersectionObserver === "undefined" ? null : parse(value);
    parsedRef.current = parsed;
    if (parsed) node.textContent = render(parsed, 0);

    return () => {
      node.textContent = value;
    };
  }, [value]);

  useEffect(() => {
    const node = liveRef.current;
    const parsed = parsedRef.current;
    if (!node || !parsed) return;

    let frame = 0;
    let startTimer = 0;
    let safetyTimer = 0;
    let started = false;
    let finished = false;

    const settle = () => {
      finished = true;
      cancelAnimationFrame(frame);
      window.clearTimeout(safetyTimer);
      node.textContent = value;
    };

    const start = () => {
      if (started) return;
      started = true;
      window.clearTimeout(startTimer);
      observer.disconnect();

      // Safety net on an independent clock: animation frames can be paused
      // (hidden tab, throttled background) and the accessible text must never
      // be left stranded at a partial value.
      safetyTimer = window.setTimeout(settle, DURATION + 400);

      // The clock is taken from the first animation frame, so start and
      // progress always come from the same timeline.
      let begin = 0;
      const step = (now: number) => {
        if (finished) return;
        if (!begin) begin = now;
        const t = Math.min(1, (now - begin) / DURATION);
        if (t >= 1) {
          settle();
          return;
        }
        const eased = 1 - Math.pow(1 - t, 3);
        node.textContent = render(parsed, parsed.value * eased);
        frame = requestAnimationFrame(step);
      };
      frame = requestAnimationFrame(step);
    };

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) start();
      },
      { threshold: 0.35 },
    );
    observer.observe(node);
    startTimer = window.setTimeout(start, FALLBACK_DELAY);

    return () => {
      observer.disconnect();
      window.clearTimeout(startTimer);
      settle();
    };
  }, [value]);

  return (
    <span className={`amount-anim${className ? ` ${className}` : ""}`}>
      {/* Reserves the final width — counting can never shift the layout. */}
      <span className="amount-anim-ghost" aria-hidden="true">
        {value}
      </span>
      <span className="amount-anim-live" ref={liveRef}>
        {value}
      </span>
    </span>
  );
}
