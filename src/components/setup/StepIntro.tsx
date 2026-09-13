import type { ReactNode } from "react";

/** Title of one wizard step, with an optional one-line explanation. */
export default function StepIntro({ title, text }: { title: string; text?: ReactNode }) {
  return (
    <header>
      <h2 className="text-[length:var(--fs-md)] font-bold">{title}</h2>
      {text && <p className="muted mt-1 text-[length:var(--fs-xs)] leading-6">{text}</p>}
    </header>
  );
}

/** Two-option currency switch for a purchase price. */
export function CurrencySwitch<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (next: T) => void;
  label: string;
}) {
  return (
    <div className="seg" role="group" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          onClick={() => onChange(option.value)}
          className={value === option.value ? "seg-on" : ""}
          aria-pressed={value === option.value}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
