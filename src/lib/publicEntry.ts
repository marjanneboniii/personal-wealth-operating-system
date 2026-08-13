import { isNotNull } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";

export type HomeMode = "app" | "landing";

/**
 * `/` is the public marketing landing when a session is required
 * (at least one username exists) and the visitor is signed out.
 * Authenticated users and the legacy single-tenant bootstrap still
 * see the wealth dashboard. Fail-open to landing so a broken
 * session/database never paints the private app chrome.
 */
export async function resolveHomeMode(
  knownUser?: Awaited<ReturnType<typeof getCurrentUser>>,
): Promise<HomeMode> {
  try {
    const user = knownUser === undefined ? await getCurrentUser() : knownUser;
    if (user) return "app";
    const [named] = await db.select({ id: users.id }).from(users).where(isNotNull(users.username)).limit(1);
    if (named) return "landing";
    const [legacy] = await db.select({ id: users.id }).from(users).limit(1);
    // Unnamed single-tenant owner still uses the open dashboard.
    // A fresh install (no users yet) shows the public marketing page.
    return legacy ? "app" : "landing";
  } catch {
    return "landing";
  }
}
