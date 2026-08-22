"use client";

import { createContext, useContext, type ReactNode } from "react";

/*
 * ──────────────────────────────────────────────────────────────────────────
 * Global Pro Mode context (Directive §2).
 *
 * The initial value is resolved ON THE SERVER inside the root layout from the
 * authenticated user's own `user_preferences` row — never from a shared store,
 * never from localStorage — so one tenant's preference can never bleed into
 * another user's render. Client components anywhere in the tree read it via
 * `useProMode()`; server components call `getUserProMode(userId)` directly.
 *
 * Default (no user / no row / any error): SIMPLE view — accounting vocabulary
 * stays hidden everywhere.
 * ──────────────────────────────────────────────────────────────────────────
 */

const ProModeContext = createContext<boolean>(false);

export function ProModeProvider({ pro, children }: { pro: boolean; children: ReactNode }) {
  return <ProModeContext.Provider value={pro}>{children}</ProModeContext.Provider>;
}

/** True only when the authenticated user explicitly enabled the professional
 *  accounting vocabulary (کد معین / بدهکار / بستانکار / دفتر کل). */
export function useProMode(): boolean {
  return useContext(ProModeContext);
}
