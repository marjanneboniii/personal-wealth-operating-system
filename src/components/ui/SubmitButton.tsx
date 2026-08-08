"use client";

import { useFormStatus } from "react-dom";
import type { ReactNode } from "react";

/** Submit button with pending state — optimistic-feeling, never blocking. */
export default function SubmitButton({
  children,
  pendingText = "در حال ثبت…",
  className = "btn btn-primary",
}: {
  children: ReactNode;
  pendingText?: string;
  className?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className={className}>
      {pending ? pendingText : children}
    </button>
  );
}
