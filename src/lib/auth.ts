import { cookies } from "next/headers";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { sessions, users } from "@/db/schema";
import crypto from "node:crypto";
import { createClient as createRawSupabaseClient } from "@supabase/supabase-js";
import { createClient as createSupabaseServerClient } from "@/lib/supabase/server";
import { hasSupabaseConfig, publicSupabaseConfig } from "@/lib/supabase/config";

const SESSION_COOKIE = "pwos_session";
const SESSION_TTL_DAYS = 30;
const PASSWORD_SCRYPT = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 } as const;

// ───────────────── Password hashing (scrypt, no extra dep) ─────────────────

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString("hex");
  const derived = crypto.scryptSync(password, salt, 64, PASSWORD_SCRYPT).toString("hex");
  return `s2:${salt}:${derived}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  if (!stored || !stored.includes(":")) return false;
  const parts = stored.split(":");
  const version = parts.length === 3 ? parts[0] : "s1";
  const salt = parts.length === 3 ? parts[1] : parts[0];
  const hash = parts.length === 3 ? parts[2] : parts[1];
  if (!salt || !hash) return false;
  const derived = crypto.scryptSync(password, salt, 64, version === "s2" ? PASSWORD_SCRYPT : undefined).toString("hex");
  // timingSafeEqual requires same length buffers
  const a = Buffer.from(hash, "hex");
  const b = Buffer.from(derived, "hex");
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

// ───────────────── Session token ─────────────────

export function generateToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

/**
 * Session tokens are stored in the database ONLY as SHA-256 hashes.
 * The raw token lives exclusively in the HttpOnly cookie. A database leak
 * therefore does not yield usable session credentials.
 */
export function hashSessionToken(token: string): string {
  return crypto.createHash("sha256").update(String(token)).digest("hex");
}

async function lookupSessionRow(tokenValue: string) {
  const rows = await db
    .select({ user: users, session: sessions })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(eq(sessions.token, tokenValue))
    .limit(1);
  return rows[0];
}

export async function createSession(userId: string): Promise<{ token: string; expiresAt: Date }> {
  if (hasSupabaseConfig()) throw new Error("Custom sessions are disabled; use Supabase Auth");
  const token = generateToken();
  const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000);
  // Store only the hash — never the raw token.
  await db.insert(sessions).values({ userId, token: hashSessionToken(token), expiresAt });
  return { token, expiresAt };
}

export async function destroySession(token: string): Promise<void> {
  if (hasSupabaseConfig()) return;
  if (!token) return;
  await db.delete(sessions).where(eq(sessions.token, hashSessionToken(token)));
}

export async function getSessionUser(token: string) {
  if (hasSupabaseConfig()) return getSupabaseProfile(token);
  if (!token) return null;
  const hashed = hashSessionToken(token);
  let row: { user: typeof users.$inferSelect; session: typeof sessions.$inferSelect } | undefined;
  try {
    // Never compare the caller-provided value directly with the database.
    // Doing so would make a stolen database hash usable as a bearer token.
    row = await lookupSessionRow(hashed);
    if (!row) {
      // Cleanup-only compatibility for already-expired raw legacy rows. A
      // live raw row is never authenticated or upgraded.
      const legacyExpired = await lookupSessionRow(token);
      if (legacyExpired?.session.expiresAt && new Date(legacyExpired.session.expiresAt) < new Date()) {
        await db.delete(sessions).where(eq(sessions.token, token));
      }
    }
  } catch (e) {
    throw new Error("Authentication/Database error: Access denied");
  }
  if (!row) return null;
  if (row.session.expiresAt && new Date(row.session.expiresAt) < new Date()) {
    // expired — clean up the hash-at-rest row
    try {
      await db.delete(sessions).where(eq(sessions.token, hashed));
    } catch {}
    return null;
  }
  return row.user;
}

export async function getCurrentUser() {
  if (hasSupabaseConfig()) return getSupabaseProfile();
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get(SESSION_COOKIE)?.value;
    if (!token) return null;
    return await getSessionUser(token);
  } catch (e: any) {
    if (e?.message?.includes("Authentication/Database error")) {
      throw e;
    }
    return null;
  }
}

export async function getCurrentUserFromRequest(request: Request) {
  if (hasSupabaseConfig()) {
    const bearer = request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
    return getSupabaseProfile(bearer);
  }
  try {
    const cookieHeader = request.headers.get("cookie");
    if (cookieHeader) {
      const match = cookieHeader.match(new RegExp(`(?:^|; )${SESSION_COOKIE}=([^;]+)`));
      if (match && match[1]) {
        return await getSessionUser(match[1].trim());
      }
    }
  } catch (e: any) {
    if (e?.message?.includes("Authentication/Database error")) {
      throw e;
    }
  }
  return await getCurrentUser();
}

export async function invalidateAllSessions(txDb: any = db): Promise<void> {
  if (hasSupabaseConfig()) return;
  await txDb.delete(sessions);
}

export async function setSessionCookie(token: string, expiresAt: Date) {
  if (hasSupabaseConfig()) throw new Error("Custom session cookies are disabled; use Supabase Auth");
  try {
    const cookieStore = await cookies();
    cookieStore.set(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      expires: expiresAt,
      secure: process.env.NODE_ENV === "production",
    });
  } catch {
    // Suppress invariant error if called outside Next.js request context
  }
}

export async function clearSessionCookie() {
  if (hasSupabaseConfig()) {
    const supabase = await createSupabaseServerClient();
    await supabase.auth.signOut({ scope: "local" });
    return;
  }
  try {
    const cookieStore = await cookies();
    cookieStore.set(SESSION_COOKIE, "", {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      expires: new Date(0),
      maxAge: 0,
      secure: process.env.NODE_ENV === "production",
    });
  } catch {
    // Suppress invariant error if called outside Next.js request context
  }
}

export async function requireUser() {
  const user = await getCurrentUser();
  if (!user) return null;
  return user;
}

export function sanitizeUser(u: typeof users.$inferSelect) {
  return {
    id: u.id,
    name: u.name,
    username: (u as any).username ?? null,
    email: (u as any).email ?? null,
    role: u.role,
  };
}

// For middleware (edge not available, but use same logic)
export const SESSION_COOKIE_NAME = SESSION_COOKIE;

async function getSupabaseProfile(accessToken?: string) {
  try {
    const supabase = accessToken
      ? (() => {
          const { url, key } = publicSupabaseConfig();
          return createRawSupabaseClient(url, key, {
            global: { headers: { Authorization: `Bearer ${accessToken}` } },
            auth: { persistSession: false, autoRefreshToken: false },
          });
        })()
      : await createSupabaseServerClient();
    const { data, error } = await supabase.auth.getUser(accessToken);
    if (error || !data.user) return null;
    const [profile] = await db.select().from(users).where(eq(users.id, data.user.id)).limit(1);
    return profile ?? null;
  } catch {
    throw new Error("Authentication/Database error: Access denied");
  }
}
