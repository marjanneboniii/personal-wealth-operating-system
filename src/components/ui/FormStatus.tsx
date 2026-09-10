"use client";

import { useEffect, useId, useRef } from "react";
import Icon from "@/components/ui/Icon";

/**
 * FormStatus — one shape for the result of every financial form.
 *
 * The server contract is unchanged: it still receives `{ ok, message }` from
 * the action and renders that message verbatim. What it adds is the part that
 * was missing everywhere except the login form:
 *
 *   • a FAILURE is announced assertively (`role="alert"`), not politely —
 *     a rejected financial submission is not a status update;
 *   • focus moves to the message on failure, so a keyboard or screen-reader
 *     user lands on the reason instead of being left at the submit button;
 *   • the message carries a stable id, so the form can point
 *     `aria-describedby` at it (see `useFormStatus`-style usage below).
 *
 * Per-FIELD errors are deliberately not attempted: `ActionResult` carries a
 * single form-level message, and inventing a field mapping in the client
 * would be guesswork.
 */
export function FormStatus({
  state,
  id,
}: {
  state: { ok: boolean; message: string } | null;
  /** Pass the id used in the form's aria-describedby, when wiring it. */
  id?: string;
}) {
  const auto = useId();
  const messageId = id ?? auto;
  const ref = useRef<HTMLParagraphElement>(null);
  const failed = !!state && !state.ok;

  useEffect(() => {
    if (failed) ref.current?.focus();
  }, [failed, state?.message]);

  if (!state) return null;

  return (
    <p
      id={messageId}
      ref={ref}
      tabIndex={failed ? -1 : undefined}
      role={failed ? "alert" : "status"}
      aria-live={failed ? "assertive" : "polite"}
      className="form-status"
      data-tone={state.ok ? "ok" : "error"}
    >
      <Icon name={state.ok ? "check" : "alert"} size={15} />
      <span>{state.message}</span>
    </p>
  );
}

/**
 * Ids for wiring a form to its status message:
 * `<form aria-describedby={ids.message} aria-invalid={ids.invalid}>`
 */
export function useFormStatusIds(state: { ok: boolean } | null) {
  const message = useId();
  return { message, invalid: state && !state.ok ? true : undefined } as const;
}
