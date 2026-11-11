"use client";

import { useId, useRef, useState, type ReactNode } from "react";
import { toFaDigits, toLatinDigits } from "@/lib/format";

export interface PlateValue {
  part1: string; // دو رقم اول
  letter: string; // حرف الفبا
  part2: string; // سه رقم وسط
  region: string; // دو رقم کد منطقه (ایران ...)
}

export const PLATE_LETTERS = [
  "ب", "ج", "د", "س", "ص", "ط", "ق", "ل", "م", "ن", "و", "ه", "ی",
  "الف", "ت", "ع", "ژ"
] as const;

export interface PlateInputProps {
  label?: ReactNode;
  hint?: ReactNode;
  value?: PlateValue;
  defaultValue?: Partial<PlateValue>;
  onChange?: (plate: PlateValue, isValid: boolean) => void;
  name?: string;
  disabled?: boolean;
  className?: string;
}

const EMPTY_PLATE: PlateValue = { part1: "", letter: "ب", part2: "", region: "" };

/**
 * PlateInput — ورودی پلاک خودروی ملی ایران بر پایه الگوی کاشی ۲.۰
 * شامل هدایت خودکار فوکوس (Auto-advance) بین دو رقم، حرف، سه رقم و کد منطقه.
 */
export default function PlateInput({
  label,
  hint,
  value,
  defaultValue,
  onChange,
  name,
  disabled = false,
  className = "",
}: PlateInputProps) {
  const id = useId();
  const [inner, setInner] = useState<PlateValue>({ ...EMPTY_PLATE, ...defaultValue });
  const plate = value ?? inner;

  const part1Ref = useRef<HTMLInputElement>(null);
  const letterRef = useRef<HTMLSelectElement>(null);
  const part2Ref = useRef<HTMLInputElement>(null);
  const regionRef = useRef<HTMLInputElement>(null);

  const cleanDigits = (v: string, maxLen: number) => {
    return toLatinDigits(v).replace(/[^\d]/g, "").slice(0, maxLen);
  };

  const update = (patch: Partial<PlateValue>) => {
    const next = { ...plate, ...patch };
    if (value === undefined) setInner(next);
    const isValid =
      next.part1.length === 2 &&
      Boolean(next.letter) &&
      next.part2.length === 3 &&
      next.region.length === 2;
    onChange?.(next, isValid);
  };

  return (
    <div className={`plate-input-container space-y-1.5 ${className}`}>
      {label && (
        <label className="block text-xs font-semibold text-[var(--text-2)]" htmlFor={`${id}-part1`}>
          {label}
        </label>
      )}

      {/* قاب فلزی پلاک ایران */}
      <div
        className={`inline-flex items-center overflow-hidden rounded-[var(--r-md)] border-2 border-[var(--border-strong)] bg-white text-neutral-900 shadow-sm transition-all focus-within:border-[var(--action)] focus-within:ring-2 focus-within:ring-[var(--action-soft)] ${
          disabled ? "opacity-50 pointer-events-none" : ""
        }`}
        dir="rtl"
      >
        {/* نوار آبی نماد ایران در سمت راست پلاک */}
        <div className="flex h-11 w-8 flex-col items-center justify-between bg-[#15438c] py-1 text-white select-none">
          <div className="flex flex-col items-center leading-none">
            <span className="text-[7px] font-bold">🇮🇷</span>
            <span className="text-[6px] tracking-tighter">I.R.</span>
            <span className="text-[6px] tracking-tighter">IRAN</span>
          </div>
          <span className="text-[8px] font-bold">ایران</span>
        </div>

        {/* بخش دو رقم اول */}
        <input
          id={`${id}-part1`}
          ref={part1Ref}
          type="text"
          inputMode="numeric"
          disabled={disabled}
          value={toFaDigits(plate.part1)}
          placeholder="۱۲"
          className="h-11 w-11 bg-transparent text-center font-bold text-base outline-none tracking-wider text-neutral-900"
          onChange={(e) => {
            const v = cleanDigits(e.target.value, 2);
            update({ part1: v });
            if (v.length === 2) {
              letterRef.current?.focus();
            }
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowLeft") {
              e.preventDefault();
              letterRef.current?.focus();
            }
          }}
        />

        {/* حرف الفبای پلاک */}
        <div className="relative border-x border-neutral-300 px-1">
          <select
            ref={letterRef}
            disabled={disabled}
            value={plate.letter}
            className="h-11 appearance-none bg-transparent px-2 text-center font-bold text-base outline-none cursor-pointer text-neutral-900"
            onChange={(e) => {
              update({ letter: e.target.value });
              part2Ref.current?.focus();
            }}
            onKeyDown={(e) => {
              if (e.key === "Backspace" && !plate.part1) {
                part1Ref.current?.focus();
              } else if (e.key === "ArrowLeft") {
                part2Ref.current?.focus();
              } else if (e.key === "ArrowRight") {
                part1Ref.current?.focus();
              }
            }}
          >
            {PLATE_LETTERS.map((l) => (
              <option key={l} value={l}>
                {l}
              </option>
            ))}
          </select>
        </div>

        {/* بخش سه رقم وسط */}
        <input
          ref={part2Ref}
          type="text"
          inputMode="numeric"
          disabled={disabled}
          value={toFaDigits(plate.part2)}
          placeholder="۳۴۵"
          className="h-11 w-14 bg-transparent text-center font-bold text-base outline-none tracking-wider text-neutral-900"
          onChange={(e) => {
            const v = cleanDigits(e.target.value, 3);
            update({ part2: v });
            if (v.length === 3) {
              regionRef.current?.focus();
            }
          }}
          onKeyDown={(e) => {
            if (e.key === "Backspace" && !plate.part2) {
              letterRef.current?.focus();
            } else if (e.key === "ArrowLeft") {
              regionRef.current?.focus();
            } else if (e.key === "ArrowRight") {
              letterRef.current?.focus();
            }
          }}
        />

        {/* خط جداکننده منطقه */}
        <div className="flex h-11 flex-col items-center justify-center border-r border-neutral-300 bg-neutral-100 px-2 select-none">
          <span className="text-[9px] font-semibold text-neutral-500">ایران</span>
          <input
            ref={regionRef}
            type="text"
            inputMode="numeric"
            disabled={disabled}
            value={toFaDigits(plate.region)}
            placeholder="۲۲"
            className="h-6 w-8 bg-transparent text-center font-bold text-sm outline-none text-neutral-900"
            onChange={(e) => {
              const v = cleanDigits(e.target.value, 2);
              update({ region: v });
            }}
            onKeyDown={(e) => {
              if (e.key === "Backspace" && !plate.region) {
                part2Ref.current?.focus();
              } else if (e.key === "ArrowRight") {
                part2Ref.current?.focus();
              }
            }}
          />
        </div>
      </div>

      {name && (
        <input
          type="hidden"
          name={name}
          value={`${plate.part1}${plate.letter}${plate.part2}-${plate.region}`}
        />
      )}

      {hint && <p className="text-xs text-[var(--text-3)]">{hint}</p>}
    </div>
  );
}
