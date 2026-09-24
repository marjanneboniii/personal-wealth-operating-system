"use client";

/**
 * «+ افزودن» — one button, one sheet, the same everywhere.
 *
 * Planning used to hide its capture forms in stacked `<details>` panels at the
 * bottom of every page, so adding a budget or a goal meant scrolling past the
 * whole report first. The button now sits in the page header (and inside the
 * empty state, where it is the obvious next step) and opens the form as a
 * sheet — the pattern «ثبت هزینه» already uses.
 *
 * Where a page can add more than one thing, the sheet opens on a segment and
 * the forms share it; nothing is nested deeper than that.
 */
import { useState, type ReactNode } from "react";
import Icon from "@/components/ui/Icon";
import Sheet from "@/components/ui/Sheet";
import {
  BudgetCardForm,
  EventCardForm,
  GoalCardForm,
  PlannedCardForm,
  type AccountOpt,
  type RateProps,
} from "./PlanningForms";

type LauncherProps = {
  /** Header button caption — the empty states pass their own wording. */
  label?: string;
  /** Soft inside an empty state, primary in a page header. */
  variant?: "primary" | "soft";
};

function Launcher({
  label,
  variant = "primary",
  title,
  children,
}: LauncherProps & { title: string; children: (close: () => void) => ReactNode }) {
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);
  return (
    <>
      <button
        type="button"
        className={`btn ${variant === "soft" ? "btn-soft" : "btn-primary"}`}
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        <Icon name="plus" size={16} strokeWidth={2.2} />
        {label ?? title}
      </button>
      <Sheet open={open} onClose={close} title={title} wide>
        {/* Mounted per open: every visit starts from a clean form. */}
        {open && children(close)}
      </Sheet>
    </>
  );
}

/** Sheet-level segment — which of the things this page can add. */
function KindSeg<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: Array<[T, string]>;
}) {
  return (
    <div className="expense-seg mx-3 mt-3 sm:mx-4" role="tablist" aria-label="چه چیزی اضافه می‌کنید؟">
      {options.map(([key, text]) => {
        const on = value === key;
        return (
          <button key={key} type="button" role="tab" aria-selected={on} data-on={on || undefined} onClick={() => onChange(key)}>
            {text}
          </button>
        );
      })}
    </div>
  );
}

type FormProps = { accounts: AccountOpt[]; today: string } & RateProps;

export function AddBudgetButton({ accounts, tags, today, label, variant, ...rate }: FormProps & LauncherProps & { tags?: string[] }) {
  return (
    <Launcher title="بودجه جدید" label={label} variant={variant}>
      {(close) => <BudgetCardForm accounts={accounts} tags={tags} today={today} onDone={close} {...rate} />}
    </Launcher>
  );
}

/** اهداف و صندوق‌ها — a goal or a future event. */
export function AddGoalButton({ accounts, today, label, variant, ...rate }: FormProps & LauncherProps) {
  const [kind, setKind] = useState<"goal" | "event">("goal");
  return (
    <Launcher title="افزودن" label={label ?? "هدف یا رویداد"} variant={variant}>
      {(close) => (
        <>
          <KindSeg
            value={kind}
            onChange={setKind}
            options={[
              ["goal", "هدف مالی"],
              ["event", "رویداد آینده"],
            ]}
          />
          {kind === "goal" ? (
            <GoalCardForm accounts={accounts} today={today} onDone={close} {...rate} />
          ) : (
            <EventCardForm today={today} onDone={close} {...rate} />
          )}
        </>
      )}
    </Launcher>
  );
}

/** پیش‌بینی مالی — a planned transaction, a goal or an event. */
export function AddPlanButton({ accounts, today, label, variant, ...rate }: FormProps & LauncherProps) {
  const [kind, setKind] = useState<"planned" | "goal" | "event">("planned");
  return (
    <Launcher title="افزودن برنامه" label={label ?? "برنامه جدید"} variant={variant}>
      {(close) => (
        <>
          <KindSeg
            value={kind}
            onChange={setKind}
            options={[
              ["planned", "تراکنش برنامه‌ریزی‌شده"],
              ["goal", "هدف مالی"],
              ["event", "رویداد آینده"],
            ]}
          />
          {kind === "planned" && <PlannedCardForm accounts={accounts} today={today} onDone={close} {...rate} />}
          {kind === "goal" && <GoalCardForm accounts={accounts} today={today} onDone={close} {...rate} />}
          {kind === "event" && <EventCardForm today={today} onDone={close} {...rate} />}
        </>
      )}
    </Launcher>
  );
}
