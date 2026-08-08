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
}: {
  kind: Kind;
  id?: string;
  cashAccountId?: string;
  label: string;
  primary?: boolean;
  confirmText?: string;
}) {
  const [pending, start] = useTransition();
  const [result, setResult] = useState<ActionResult | null>(null);

  const run = () => {
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
    <span className="inline-flex flex-col items-stretch gap-1">
      <button
        onClick={run}
        disabled={pending || (kind === "pay-installment" && !cashAccountId)}
        className={`btn !min-h-9 !px-3 !py-1.5 text-[11px] ${primary ? "btn-primary" : ""}`}
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
