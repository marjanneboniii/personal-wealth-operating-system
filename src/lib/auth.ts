import { cookies } from "next/headers";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { sessions, users } from "@/db/schema";
import crypto from "node:crypto";

const SESSION_COOKIE = "pwos_session";
const SESSION_TTL_DAYS = 30;

// ───────────────── Password hashing (scrypt, no extra dep) ─────────────────

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString("hex");
  const derived = crypto.scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${derived}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  if (!stored || !stored.includes(":")) return false;
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const derived = crypto.scryptSync(password, salt, 64).toString("hex");
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
  const token = generateToken();
  const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000);
  // Store only the hash — never the raw token.
  await db.insert(sessions).values({ userId, token: hashSessionToken(token), expiresAt });
  return { token, expiresAt };
}

export async function destroySession(token: string): Promise<void> {
  if (!token) return;
  // Delete by hash (current format) and by raw value (legacy rows only).
  await db.delete(sessions).where(eq(sessions.token, hashSessionToken(token)));
  await db.delete(sessions).where(eq(sessions.token, token));
}

export async function getSessionUser(token: string) {
  if (!token) return null;
  const hashed = hashSessionToken(token);
  let row: { user: typeof users.$inferSelect; session: typeof sessions.$inferSelect } | undefined;
  try {
    row = await lookupSessionRow(hashed);
    if (!row) {
      // Transitional compatibility: sessions created before hash-at-rest
      // stored the raw token. If such a legacy row is presented, upgrade it
      // in place to hash storage on first use. Only pre-existing rows can
      // ever match the raw path — new sessions are hashed on creation.
      const legacyRow = await lookupSessionRow(token);
      if (legacyRow) {
        try {
          await db.update(sessions).set({ token: hashed }).where(eq(sessions.token, token));
        } catch {}
        row = legacyRow;
      }
    }
  } catch (e) {
    throw new Error("Authentication/Database error: Access denied");
  }
  if (!row) return null;
  if (row.session.expiresAt && new Date(row.session.expiresAt) < new Date()) {
    // expired — clean up (hash form first, raw form for any legacy row)
    try {
      await db.delete(sessions).where(eq(sessions.token, hashed));
      await db.delete(sessions).where(eq(sessions.token, token));
    } catch {}
    return null;
  }
  return row.user;
}

export async function getCurrentUser() {
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
  await txDb.delete(sessions);
}

export async function setSessionCookie(token: string, expiresAt: Date) {
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
    googleId: (u as any).googleId ?? null,
  };
}

// For middleware (edge not available, but use same logic)
export const SESSION_COOKIE_NAME = SESSION_COOKIE;
