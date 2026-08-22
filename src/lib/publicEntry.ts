import { getCurrentUser } from "@/lib/auth";

export type HomeMode = "app" | "landing";

/**
 * LOGIN-GATED APP (Global System Directive §0): `/` is the public marketing
 * landing for every signed-out visitor. Only authenticated users (login or
 * registration) see the wealth dashboard. The historical legacy branch (an
 * unnamed single-tenant owner keeping an open dashboard) is gone.
 * Fail-open to landing so a broken session/database never paints the
 * private app chrome.
 */
export async function resolveHomeMode(
  knownUser?: Awaited<ReturnType<typeof getCurrentUser>>,
): Promise<HomeMode> {
  try {
    const user = knownUser === undefined ? await getCurrentUser() : knownUser;
    return user ? "app" : "landing";
  } catch {
    return "landing";
  }
}
