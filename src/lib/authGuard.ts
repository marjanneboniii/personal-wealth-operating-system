import { redirect } from "next/navigation";
import { db } from "@/db";
import { users } from "@/db/schema";
import { isNotNull } from "drizzle-orm";
import { getCurrentUser, getCurrentUserFromRequest } from "@/lib/auth";

/**
 * Call at top of any protected server component.
 * - If no auth users exist (legacy single-tenant mode), allow without login (preserves 1456 data before migration).
 * - If auth users exist and no session, redirect to /login.
 * - Otherwise allow.
 * Fail-Closed: DB errors throw instead of allowing access.
 */
export async function ensureAuth() {
  const user = await getCurrentUser();
  if (user) return user;

  let hasAuth: unknown;
  try {
    const [row] = await db.select().from(users).where(isNotNull(users.username)).limit(1);
    hasAuth = row;
  } catch (e: any) {
    if (e?.digest?.startsWith("NEXT_REDIRECT") || e?.message === "NEXT_REDIRECT") {
      throw e;
    }
    // Fail-Closed: if DB check fails, deny access
    throw new Error("Authentication/Database error: Access denied");
  }

  if (hasAuth) {
    redirect("/login");
  }
  return null;
}

export async function requireAuth() {
  return ensureAuth();
}

/**
 * For API routes / actions: throw if auth required but not logged in.
 * Fail-Closed: DB errors throw instead of allowing access.
 */
export async function requireAuthForApi() {
  const user = await getCurrentUser();
  if (user) return user;

  let hasAuth: unknown;
  try {
    const [row] = await db.select().from(users).where(isNotNull(users.username)).limit(1);
    hasAuth = row;
  } catch (e: any) {
    if (e instanceof Error && e.message.includes("Unauthorized")) throw e;
    // Fail-Closed: if DB check fails, deny access
    throw new Error("Authentication/Database error: Access denied");
  }

  if (hasAuth) {
    throw new Error("Unauthorized: login required");
  }
  return null;
}

/**
 * Authenticates an API request via User Session or explicit PWOS_AUTH_TOKEN secret.
 * Fail-Closed: Never falls back to true when PWOS_AUTH_TOKEN is omitted.
 */
export async function authenticateApi(request: Request) {
  const authToken = process.env.PWOS_AUTH_TOKEN;
  if (authToken && authToken.trim() !== "") {
    const headerToken =
      request.headers.get("x-pwos-auth") ??
      request.headers.get("authorization")?.replace("Bearer ", "");
    if (headerToken === authToken) {
      return { authenticated: true, user: { id: "admin-token", role: "owner", name: "System Admin" } };
    }
  }

  const user = await getCurrentUserFromRequest(request);
  if (!user) {
    return { authenticated: false, user: null };
  }
  return { authenticated: true, user };
}

/**
 * Authorizes an API request requiring Owner or Admin permissions (e.g. Backup / Restore).
 */
export async function authorizeOwnerOrAdmin(request: Request) {
  const auth = await authenticateApi(request);
  if (!auth.authenticated || !auth.user) {
    return { ok: false, status: 401, error: "دسترسی غیرمجاز (401 Unauthorized)" };
  }
  if (auth.user.role !== "owner" && auth.user.role !== "admin") {
    return { ok: false, status: 403, error: "شما مجوز این عملیات را ندارید (403 Forbidden)" };
  }
  return { ok: true, status: 200, user: auth.user };
}

