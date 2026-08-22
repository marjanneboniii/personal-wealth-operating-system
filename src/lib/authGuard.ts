import { redirect } from "next/navigation";
import { getCurrentUser, getCurrentUserFromRequest } from "@/lib/auth";
import { safeEqual } from "@/lib/rateLimit";

/** Roles considered privileged (administrative). Assigned server-side only. */
export function isAdminOrOwner(user: { role?: string | null } | null | undefined): boolean {
  return !!user && (user.role === "owner" || user.role === "admin");
}

/**
 * Call at top of any protected server component.
 * LOGIN-GATED APP (Global System Directive §0): a signed-out visitor never
 * sees app pages — they are redirected to /login. The public marketing
 * landing lives at `/`. The historical legacy path (anonymous access while no
 * auth users existed yet) has been removed: the app is visible only after
 * login/registration, and every tenant sees only their own data.
 * Fail-Closed: DB/session errors throw instead of allowing access.
 */
export async function ensureAuth() {
  const user = await getCurrentUser();
  if (user) return user;
  redirect("/login");
}

export async function requireAuth() {
  return ensureAuth();
}

/**
 * For API routes / actions: throw if not logged in.
 * Fail-Closed: DB errors throw instead of allowing access.
 */
export async function requireAuthForApi() {
  const user = await getCurrentUser();
  if (!user) {
    throw new Error("Unauthorized: login required");
  }
  return user;
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
    // Constant-time comparison for the system admin token.
    if (headerToken && safeEqual(headerToken, authToken)) {
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
    return { ok: false, status: 401, error: "دسترسی غیرمجاز (401 Unauthorized)", user: null };
  }
  // Role is read exclusively from the server-side session/token user —
  // never from the request body, query, or headers.
  if (auth.user.role !== "owner" && auth.user.role !== "admin") {
    return { ok: false, status: 403, error: "شما مجوز این عملیات را ندارید (403 Forbidden)", user: auth.user };
  }
  return { ok: true, status: 200, user: auth.user };
}

