import { redirect } from "next/navigation";
import { db } from "@/db";
import { users } from "@/db/schema";
import { isNotNull } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";

/**
 * Call at top of any protected server component.
 * - If no auth users exist (legacy single-tenant mode), allow without login (preserves 1456 data before migration).
 * - If auth users exist and no session, redirect to /login.
 * - Otherwise allow.
 */
export async function ensureAuth() {
  const user = await getCurrentUser();
  if (user) return user;

  // Check if any user has username (auth system has been activated)
  try {
    const [hasAuth] = await db.select().from(users).where(isNotNull(users.username)).limit(1);
    if (hasAuth) {
      redirect("/login");
    }
  } catch {
    // If DB check fails, allow (don't block)
  }
  // No auth users yet — legacy mode, allow
  return null;
}

/**
 * For API routes / actions: throw if auth required but not logged in.
 */
export async function requireAuthForApi() {
  const user = await getCurrentUser();
  if (user) return user;
  try {
    const [hasAuth] = await db.select().from(users).where(isNotNull(users.username)).limit(1);
    if (hasAuth) throw new Error("Unauthorized: login required");
  } catch (e) {
    if (e instanceof Error && e.message.includes("Unauthorized")) throw e;
  }
  return null;
}
