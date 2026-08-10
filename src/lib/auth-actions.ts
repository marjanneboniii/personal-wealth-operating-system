"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { users, userFxSettings } from "@/db/schema";
import { eq, isNull, or } from "drizzle-orm";
import { hashPassword, verifyPassword, createSession, setSessionCookie, clearSessionCookie, destroySession, getCurrentUser } from "@/lib/auth";
import { cookies } from "next/headers";
import { recordAuditEvent } from "@/lib/audit";

export type AuthResult = { ok: boolean; message: string; redirectTo?: string };

// ───────────── Register (username + password) ─────────────

export async function registerAction(prev: AuthResult | null, formData: FormData): Promise<AuthResult> {
  const username = String(formData.get("username") || "").trim();
  const password = String(formData.get("password") || "");
  const confirmPassword = String(formData.get("confirmPassword") || "");
  const name = String(formData.get("name") || "").trim() || username;

  const { checkRateLimit } = await import("@/lib/rateLimit");
  if (!checkRateLimit(`register:${username || "anon"}`, 10, 60).ok) {
    return { ok: false, message: "تعداد تلاش‌ها بیش از حد مجاز است. لطفاً کمی صبر کنید." };
  }

  if (!username || username.length < 3) return { ok: false, message: "نام کاربری باید حداقل ۳ کاراکتر باشد." };
  if (!/^[a-zA-Z0-9_.\-]+$/.test(username)) return { ok: false, message: "نام کاربری فقط می‌تواند شامل حروف انگلیسی، عدد، _ و - باشد." };
  if (!password || password.length < 6) return { ok: false, message: "رمز عبور باید حداقل ۶ کاراکتر باشد." };
  if (password !== confirmPassword) return { ok: false, message: "تکرار رمز عبور مطابقت ندارد." };

  // Check existing username
  const [existingByUsername] = await db.select().from(users).where(eq(users.username, username)).limit(1);
  if (existingByUsername) return { ok: false, message: "این نام کاربری قبلاً ثبت شده است." };

  const passwordHash = hashPassword(password);

  // Migration: check if there is a legacy owner without username (preserve 1456 data)
  // Legacy detection: users where username IS NULL (single-tenant before auth)
  const legacyUsers = await db.select().from(users).where(isNull(users.username));
  let userId: string;
  if (legacyUsers.length === 1 && legacyUsers[0].role === "owner") {
    // Claim the legacy owner — update existing row to become auth user, preserving all financial data
    const legacy = legacyUsers[0];
    await db
      .update(users)
      .set({ username, passwordHash, name: name || legacy.name, updatedAt: new Date() } as any)
      .where(eq(users.id, legacy.id));
    userId = legacy.id;
  } else if (legacyUsers.length > 0) {
    // Multiple legacy rows? Pick first without username that has no password, claim it if only one has no credentials
    // For safety, if multiple, create new user instead of claiming
    const [newUser] = await db
      .insert(users)
      .values({ name: name || username, username, passwordHash, role: "owner" } as any)
      .returning();
    userId = newUser.id;
  } else {
    const [newUser] = await db
      .insert(users)
      .values({ name: name || username, username, passwordHash, role: "owner" } as any)
      .returning();
    userId = newUser.id;
  }

  // Ensure user has fx settings with default 190000
  try {
    await db.insert(userFxSettings).values({ userId, currentRate: "190000" }).onConflictDoNothing();
  } catch {}

  const { token, expiresAt } = await createSession(userId);
  await setSessionCookie(token, expiresAt);

  return { ok: true, message: "حساب با موفقیت ایجاد شد.", redirectTo: "/" };
}

// ───────────── Login ─────────────

export async function loginAction(prev: AuthResult | null, formData: FormData): Promise<AuthResult> {
  const username = String(formData.get("username") || "").trim();
  const password = String(formData.get("password") || "");

  const { checkRateLimit } = await import("@/lib/rateLimit");
  if (!checkRateLimit(`login:${username || "anon"}`, 10, 60).ok) {
    return { ok: false, message: "تعداد تلاش‌ها بیش از حد مجاز است. لطفاً کمی صبر کنید." };
  }

  if (!username || !password) return { ok: false, message: "نام کاربری و رمز عبور را وارد کنید." };

  const [user] = await db
    .select()
    .from(users)
    .where(or(eq(users.username, username), eq(users.email, username)))
    .limit(1);
  if (!user || !(user as any).passwordHash) {
    console.warn("[auth failure] login failed for user:", username);
    await recordAuditEvent({
      action: "LOGIN_FAILURE",
      entityType: "user",
      result: "FAILURE",
      metadata: { username },
    });
    return { ok: false, message: "نام کاربری یا رمز عبور اشتباه است." };
  }
  const hash = (user as any).passwordHash as string;
  if (!verifyPassword(password, hash)) {
    console.warn("[auth failure] invalid password for user:", username);
    await recordAuditEvent({
      action: "LOGIN_FAILURE",
      entityType: "user",
      userId: user.id,
      result: "FAILURE",
      metadata: { username },
    });
    return { ok: false, message: "نام کاربری یا رمز عبور اشتباه است." };
  }

  const { token, expiresAt } = await createSession(user.id);
  await setSessionCookie(token, expiresAt);
  await recordAuditEvent({
    action: "LOGIN_SUCCESS",
    entityType: "user",
    entityId: user.id,
    userId: user.id,
    result: "SUCCESS",
  });
  return { ok: true, message: "ورود موفق.", redirectTo: "/" };
}

// ───────────── Logout ─────────────

export async function logoutAction(): Promise<void> {
  let u: any = null;
  try {
    u = await getCurrentUser();
    const cookieStore = await cookies();
    const token = cookieStore.get("pwos_session")?.value;
    if (token) await destroySession(token);
  } catch {}
  await clearSessionCookie();
  await recordAuditEvent({
    action: "LOGOUT",
    entityType: "user",
    entityId: u?.id ?? null,
    userId: u?.id ?? null,
    result: "SUCCESS",
  });
  redirect("/login");
}

// ───────────── Claim Owner (for migration UI when legacy user has no username) ─────────────

export async function claimOwnerAction(prev: AuthResult | null, formData: FormData): Promise<AuthResult> {
  // Same as register but explicit claim flow
  return registerAction(prev, formData);
}

// ───────────── Update FX Rate (per-user, 24h limit) ─────────────

export async function updateFxRateAction(prev: AuthResult | null, formData: FormData): Promise<AuthResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, message: "ابتدا وارد شوید." };
  const rateStr = String(formData.get("rate") || "").replace(/[^0-9]/g, "");
  if (!rateStr) return { ok: false, message: "نرخ را وارد کنید." };
  const { updateUserFxRate } = await import("@/features/fx/userRate");
  const result = await updateUserFxRate(user.id, rateStr);
  if (result.ok) {
    revalidatePath("/settings");
    revalidatePath("/market-data");
    revalidatePath("/");
    revalidatePath("/net-worth");
    revalidatePath("/portfolio");
  }
  return { ok: result.ok, message: result.message };
}
