"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { users, userFxSettings, userTotpCredentials } from "@/db/schema";
import { eq, isNull, or } from "drizzle-orm";
import { verifyTurnstile } from "@/lib/turnstile";
import { decryptTotpSecret, readChallenge, signChallenge, verifyTotp } from "@/lib/totp";
import { hashPassword, verifyPassword, createSession, setSessionCookie, clearSessionCookie, destroySession, getCurrentUser } from "@/lib/auth";
import { cookies } from "next/headers";
import { recordAuditEvent } from "@/lib/audit";

export type AuthResult = { ok: boolean; message: string; redirectTo?: string; requiresTwoFactor?: boolean };

/**
 * SECURITY: roles are assigned exclusively by the backend.
 * - Public registration always receives the low-privilege role "user".
 * - Privileged roles ("owner" / "admin") are granted only through explicit,
 *   operator-controlled paths (legacy bootstrap claim with opt-in env flag,
 *   direct database administration, or restore by an existing owner/admin).
 * Any client-supplied `role` (or identity) field is ignored.
 */
const DEFAULT_SELF_REGISTERED_ROLE = "user";

/** Production password policy (registration only — never blocks existing logins). */
const MIN_PASSWORD_LENGTH = 8;
function validatePasswordPolicy(password: string): string | null {
  if (!password || password.length < MIN_PASSWORD_LENGTH) {
    return "رمز عبور باید حداقل ۸ کاراکتر باشد.";
  }
  if (!/[a-zA-Z]/.test(password) || !/\d/.test(password)) {
    return "رمز عبور باید حداقل شامل یک حرف انگلیسی و یک رقم باشد.";
  }
  return null;
}

/** Fields that must never be accepted from a registration request. */
const PRIVILEGED_FORM_FIELDS = ["role", "userId", "user_id", "googleId", "google_id", "emailVerified", "id"];

// ───────────── Register (username + password) ─────────────

export async function registerAction(prev: AuthResult | null, formData: FormData): Promise<AuthResult> {
  // SECURITY: strip any client-supplied privileged fields — role/identity are
  // backend decisions only. A request containing `role=owner` is treated
  // exactly like one without it.
  for (const field of PRIVILEGED_FORM_FIELDS) {
    try {
      formData.delete(field);
    } catch {}
  }

  const username = String(formData.get("username") || "").trim();
  const password = String(formData.get("password") || "");
  const confirmPassword = String(formData.get("confirmPassword") || "");
  const name = String(formData.get("name") || "").trim() || username;

  const { checkRateLimit, getRequestIp } = await import("@/lib/rateLimit");
  if (!checkRateLimit(`register:${username || "anon"}`, 10, 60).ok) {
    return { ok: false, message: "تعداد تلاش‌ها بیش از حد مجاز است. لطفاً کمی صبر کنید." };
  }
  const ip = await getRequestIp();
  if (ip && !checkRateLimit(`register-ip:${ip}`, 20, 60).ok) {
    return { ok: false, message: "تعداد تلاش‌ها بیش از حد مجاز است. لطفاً کمی صبر کنید." };
  }
  const captcha = await verifyTurnstile(String(formData.get("cf-turnstile-response") || ""), ip);
  if (!captcha.ok) return { ok: false, message: captcha.message };

  if (!username || username.length < 3) return { ok: false, message: "نام کاربری باید حداقل ۳ کاراکتر باشد." };
  if (!/^[a-zA-Z0-9_.\-]+$/.test(username)) return { ok: false, message: "نام کاربری فقط می‌تواند شامل حروف انگلیسی، عدد، _ و - باشد." };
  const policyError = validatePasswordPolicy(password);
  if (policyError) return { ok: false, message: policyError };
  if (password !== confirmPassword) return { ok: false, message: "تکرار رمز عبور مطابقت ندارد." };

  // Check existing username
  const [existingByUsername] = await db.select().from(users).where(eq(users.username, username)).limit(1);
  if (existingByUsername) return { ok: false, message: "این نام کاربری قبلاً ثبت شده است." };

  const passwordHash = hashPassword(password);

  // Migration: check if there is a legacy owner without username (preserve 1456 data)
  // Legacy detection: users where username IS NULL (single-tenant before auth)
  const legacyUsers = await db.select().from(users).where(isNull(users.username));
  let userId: string;
  // SECURITY: claiming the legacy owner is a privileged migration step and is
  // disabled unless the operator explicitly opts in via PWOS_ALLOW_LEGACY_CLAIM.
  // An anonymous visitor registering can therefore never take over legacy data.
  const legacyClaimAllowed = process.env.PWOS_ALLOW_LEGACY_CLAIM === "true";
  if (legacyClaimAllowed && legacyUsers.length === 1 && legacyUsers[0].role === "owner") {
    // Explicit bootstrap authorization present — claim the legacy owner,
    // preserving all financial data (existing migration path, now opt-in).
    const legacy = legacyUsers[0];
    await db
      .update(users)
      .set({ username, passwordHash, name: name || legacy.name, updatedAt: new Date() } as any)
      .where(eq(users.id, legacy.id));
    userId = legacy.id;
    await recordAuditEvent({
      action: "LEGACY_OWNER_CLAIM",
      entityType: "user",
      entityId: legacy.id,
      userId: legacy.id,
      result: "SUCCESS",
      metadata: { username },
    });
  } else {
    // Default secure path: always create a fresh low-privilege account.
    // The role comes from the backend constant — never from the request.
    const [newUser] = await db
      .insert(users)
      .values({ name: name || username, username, passwordHash, role: DEFAULT_SELF_REGISTERED_ROLE } as any)
      .returning();
    userId = newUser.id;
  }

  // Ensure user has fx settings with default 190000
  try {
    await db.insert(userFxSettings).values({ userId, currentRate: "190000" }).onConflictDoNothing();
  } catch {}

  await recordAuditEvent({
    action: "REGISTER",
    entityType: "user",
    entityId: userId,
    userId,
    result: "SUCCESS",
    metadata: { username },
  });

  return { ok: true, message: "حساب با موفقیت ایجاد شد. اکنون وارد شوید.", redirectTo: "/login" };
}

// ───────────── Login ─────────────

export async function loginAction(prev: AuthResult | null, formData: FormData): Promise<AuthResult> {
  const username = String(formData.get("username") || "").trim();
  const password = String(formData.get("password") || "");
  const otp = String(formData.get("totpCode") || "");
  const cookieStore = await cookies();

  const { checkRateLimit, getRequestIp } = await import("@/lib/rateLimit");
  const ip = await getRequestIp();
  if (otp) {
    if (!checkRateLimit(`login-2fa:${ip || "unknown"}`, 10, 60).ok) {
      return { ok: false, message: "تعداد تلاش‌ها بیش از حد مجاز است. لطفاً کمی صبر کنید.", requiresTwoFactor: true };
    }
    try {
      const challenge = cookieStore.get("pwos_2fa_challenge")?.value || "";
      const userId = readChallenge(challenge);
      if (!userId) return { ok: false, message: "زمان تأیید به پایان رسیده است. دوباره وارد شوید." };
      const [credential] = await db.select().from(userTotpCredentials).where(eq(userTotpCredentials.userId, userId)).limit(1);
      if (!credential || !verifyTotp(decryptTotpSecret(credential.secretEncrypted), otp)) {
        return { ok: false, message: "کد واردشده صحیح نیست.", requiresTwoFactor: true };
      }
      const { token, expiresAt } = await createSession(userId);
      await setSessionCookie(token, expiresAt);
      cookieStore.delete("pwos_2fa_challenge");
      await recordAuditEvent({ action: "LOGIN_SUCCESS", entityType: "user", entityId: userId, userId, result: "SUCCESS" });
      return { ok: true, message: "ورود موفق.", redirectTo: "/" };
    } catch {
      return { ok: false, message: "تأیید دو مرحله‌ای انجام نشد. لطفاً دوباره تلاش کنید.", requiresTwoFactor: true };
    }
  }

  if (!checkRateLimit(`login:${username || "anon"}`, 10, 60).ok ||
      (ip && !checkRateLimit(`login-ip:${ip}`, 30, 60).ok)) {
    return { ok: false, message: "تعداد تلاش‌ها بیش از حد مجاز است. لطفاً کمی صبر کنید." };
  }
  const captcha = await verifyTurnstile(String(formData.get("cf-turnstile-response") || ""), ip);
  if (!captcha.ok) return { ok: false, message: captcha.message };
  if (!username || !password) return { ok: false, message: "نام کاربری و رمز عبور را وارد کنید." };

  try {
    const [user] = await db.select().from(users).where(or(eq(users.username, username), eq(users.email, username))).limit(1);
    if (!user || !user.passwordHash || !verifyPassword(password, user.passwordHash)) {
      await recordAuditEvent({ action: "LOGIN_FAILURE", entityType: "user", userId: user?.id, result: "FAILURE", metadata: { username } });
      return { ok: false, message: "نام کاربری یا رمز عبور اشتباه است." };
    }
    const [credential] = await db.select({ userId: userTotpCredentials.userId }).from(userTotpCredentials).where(eq(userTotpCredentials.userId, user.id)).limit(1);
    if (credential) {
      cookieStore.set("pwos_2fa_challenge", signChallenge(user.id), {
        httpOnly: true, sameSite: "strict", secure: process.env.NODE_ENV === "production", path: "/login", maxAge: 300,
      });
      return { ok: false, message: "کد ۶ رقمی برنامه تأییدکننده را وارد کنید.", requiresTwoFactor: true };
    }
    const { token, expiresAt } = await createSession(user.id);
    await setSessionCookie(token, expiresAt);
    await recordAuditEvent({ action: "LOGIN_SUCCESS", entityType: "user", entityId: user.id, userId: user.id, result: "SUCCESS" });
    return { ok: true, message: "ورود موفق.", redirectTo: "/" };
  } catch {
    return { ok: false, message: "ارتباط با پایگاه داده برقرار نیست. داده‌های شما امن‌اند — چند لحظه دیگر دوباره تلاش کنید." };
  }
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
  revalidatePath("/");
  redirect("/");
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
    revalidatePath("/");
    revalidatePath("/net-worth");
    revalidatePath("/portfolio");
  }
  return { ok: result.ok, message: result.message };
}

// ───────────── Global Pro Mode toggle (Directive §2) ─────────────

/**
 * Per-user, server-verified toggle between the SIMPLE vocabulary view
 * (default: ورودی/خروجی، دسته‌بندی، جریان پول) and the PROFESSIONAL
 * accounting view (کد معین، بدهکار/بستانکار، جزئیات دفتر کل) across the
 * whole app. The preference row is tenant-scoped (unique user_id); it is
 * read server-side per request and revalidated everywhere it is used.
 */
export async function setProModeAction(_prev: AuthResult | null, formData: FormData): Promise<AuthResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, message: "ابتدا وارد شوید." };
  const pro = String(formData.get("proMode") ?? "") === "true";
  const { setUserProMode } = await import("@/features/preferences/service");
  const result = await setUserProMode(user.id, pro);
  if (result.ok) {
    // The flag is consumed by the root layout and every gated page.
    revalidatePath("/", "layout");
  }
  return { ok: result.ok, message: result.message };
}
