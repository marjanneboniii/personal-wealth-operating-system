"use client";

import { useState, useTransition } from "react";
import {
  executePlanAction,
  integrityCheckAction,
  payInstallmentAction,
  reverseEntryAction,
  takeSnapshotAction,
  type ActionResult,
} from "@/app/actions";

type Kind = "execute-plan" | "pay-installment" | "reverse" | "snapshot" | "integrity";

export default function RowAction({
  kind,
  id,
  cashAccountId,
  label,
  primary,
  confirmText,
  className,
}: {
  kind: Kind;
  id?: string;
  cashAccountId?: string;
  label: string;
  primary?: boolean;
  confirmText?: string;
  /** Extra classes for the wrapper — e.g. "w-full" inside a mobile card grid. */
  className?: string;
}) {
  const [pending, start] = useTransition();
  const [result, setResult] = useState<ActionResult | null>(null);

  const run = (e?: React.MouseEvent) => {
    e?.preventDefault();
    e?.stopPropagation();
    if (confirmText && !window.confirm(confirmText)) return;
    start(async () => {
      let res: ActionResult;
      if (kind === "execute-plan") res = await executePlanAction(id!);
      else if (kind === "pay-installment") res = await payInstallmentAction(id!, cashAccountId!);
      else if (kind === "reverse") res = await reverseEntryAction(id!);
      else if (kind === "snapshot") res = await takeSnapshotAction();
      else res = await integrityCheckAction();
      setResult(res);
      setTimeout(() => setResult(null), 4000);
    });
  };

  return (
    <span className={`inline-flex flex-col items-stretch gap-1 ${className ?? ""}`}>
      <button
        type="button"
        onClick={run}
        disabled={pending || (kind === "pay-installment" && !cashAccountId)}
        className={`btn !min-h-9 !px-3 !py-1.5 text-[length:var(--fs-xs)] ${primary ? "btn-primary" : ""}`}
        style={{ touchAction: "manipulation", WebkitTapHighlightColor: "transparent" } as any}
      >
        {pending ? "…" : label}
      </button>
      {result && (
        <span
          className="badge"
          role="status"
          style={
            result.ok
              ? { background: "var(--positive-soft)", color: "var(--positive)" }
              : { background: "var(--negative-soft)", color: "var(--negative)" }
          }
        >
          {result.message}
        </span>
      )}
    </span>
  );
}
