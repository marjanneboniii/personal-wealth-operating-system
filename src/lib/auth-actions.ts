"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { users, userFxSettings } from "@/db/schema";
import { eq, or } from "drizzle-orm";
import { clearSessionCookie, getCurrentUser } from "@/lib/auth";
import { recordAuditEvent } from "@/lib/audit";
import { invalidateTenantStateCache } from "@/lib/tenantState";
import { createClient as createSupabaseServerClient } from "@/lib/supabase/server";

export type AuthResult = { ok: boolean; message: string; redirectTo?: string };

/**
 * SECURITY: roles are assigned exclusively by the backend.
 * - Public registration always receives the low-privilege role "user".
 * - Privileged roles ("owner" / "admin") are granted only through explicit,
 *   operator-controlled paths (legacy bootstrap claim with opt-in env flag,
 *   direct database administration, or restore by an existing owner/admin).
 * Any client-supplied `role` (or identity) field is ignored.
 */
const DEFAULT_SELF_REGISTERED_ROLE = "user";

function canonicalSiteUrl(): string {
  const configured = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (configured) {
    const parsed = new URL(configured);
    if (process.env.NODE_ENV === "production" && parsed.protocol !== "https:") {
      throw new Error("NEXT_PUBLIC_SITE_URL must use HTTPS in production");
    }
    return parsed.origin;
  }
  if (process.env.NODE_ENV === "production") throw new Error("NEXT_PUBLIC_SITE_URL is required in production");
  return "http://localhost:3000";
}

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
const PRIVILEGED_FORM_FIELDS = ["role", "userId", "user_id", "emailVerified", "id"];

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
  const email = String(formData.get("email") || "").trim().toLowerCase();
  const password = String(formData.get("password") || "");
  const confirmPassword = String(formData.get("confirmPassword") || "");
  const name = String(formData.get("name") || "").trim() || username;
  if (username.length > 64 || email.length > 254 || name.length > 120 || password.length > 128) return { ok: false, message: "طول اطلاعات واردشده مجاز نیست." };

  const { checkRateLimit, getRequestIp } = await import("@/lib/rateLimit");
  const ip = await getRequestIp();
  const userLimit = await checkRateLimit(`register:${username || "anon"}`, 10, 60);
  if (!userLimit.ok) {
    return { ok: false, message: "تعداد تلاش‌ها بیش از حد مجاز است. لطفاً کمی صبر کنید." };
  }
  if (ip) {
    const ipLimit = await checkRateLimit(`register-ip:${ip}`, 20, 60);
    if (!ipLimit.ok) {
      return { ok: false, message: "تعداد تلاش‌ها بیش از حد مجاز است. لطفاً کمی صبر کنید." };
    }
  }

  if (!username || username.length < 3) return { ok: false, message: "نام کاربری باید حداقل ۳ کاراکتر باشد." };
  if (!/^[a-zA-Z0-9_.\-]+$/.test(username)) return { ok: false, message: "نام کاربری فقط می‌تواند شامل حروف انگلیسی، عدد، _ و - باشد." };
  if (!/^\S+@\S+\.\S+$/.test(email)) return { ok: false, message: "ایمیل معتبر وارد کنید." };
  const policyError = validatePasswordPolicy(password);
  if (policyError) return { ok: false, message: policyError };
  if (password !== confirmPassword) return { ok: false, message: "تکرار رمز عبور مطابقت ندارد." };

  // Check existing username
  const [existingByUsername] = await db.select().from(users).where(eq(users.username, username)).limit(1);
  if (existingByUsername) return { ok: false, message: "این نام کاربری قبلاً ثبت شده است." };

  const captchaToken = String(formData.get("turnstileToken") || "");
  if (!captchaToken && process.env.NODE_ENV === "production") return { ok: false, message: "تأیید امنیتی انجام نشد؛ دوباره تلاش کنید." };
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      captchaToken: captchaToken || undefined,
      emailRedirectTo: `${canonicalSiteUrl()}/auth/callback`,
      data: { name: name || username, username },
    },
  });
  if (error || !data.user) return { ok: false, message: error?.message || "ثبت‌نام انجام نشد." };
  const userId = data.user.id;
  // Never grant a privileged role from public signup input. The verified
  // Supabase callback is the only bootstrap-owner path.
  await db.update(users).set({ name: name || username, username, email, role: DEFAULT_SELF_REGISTERED_ROLE, emailVerified: Boolean(data.user.email_confirmed_at), updatedAt: new Date() } as any).where(eq(users.id, userId));

  // Registration changes the user count and/or the "auth enabled" flag, so the
  // shared tenant-state cache (used by every auth guard / ledger read) must be
  // invalidated immediately — a stale "single user / no auth" answer could
  // otherwise widen the legacy global-view window for up to the cache TTL.
  invalidateTenantStateCache();

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

  return data.session
    ? { ok: true, message: "حساب با موفقیت ایجاد شد.", redirectTo: "/" }
    : { ok: true, message: "ایمیل تأیید ارسال شد؛ پس از تأیید وارد شوید.", redirectTo: "/login" };
}

// ───────────── Login ─────────────

export async function loginAction(prev: AuthResult | null, formData: FormData): Promise<AuthResult> {
  const username = String(formData.get("username") || "").trim().toLowerCase();
  const password = String(formData.get("password") || "");
  if (username.length > 254 || password.length > 128) return { ok: false, message: "نام کاربری یا رمز عبور اشتباه است." };

  const { checkRateLimit, getRequestIp } = await import("@/lib/rateLimit");
  const ip = await getRequestIp();
  const userLimit = await checkRateLimit(`login:${username || "anon"}`, 10, 60);
  if (!userLimit.ok) {
    return { ok: false, message: "تعداد تلاش‌ها بیش از حد مجاز است. لطفاً کمی صبر کنید." };
  }
  if (ip) {
    const ipLimit = await checkRateLimit(`login-ip:${ip}`, 30, 60);
    if (!ipLimit.ok) {
      return { ok: false, message: "تعداد تلاش‌ها بیش از حد مجاز است. لطفاً کمی صبر کنید." };
    }
  }
  if (!username || !password) return { ok: false, message: "نام کاربری و رمز عبور را وارد کنید." };

  try {
    const [profile] = await db.select().from(users).where(or(eq(users.username, username), eq(users.email, username))).limit(1);
    const email = username.includes("@") ? username : profile?.email;
    if (!email) {
      await recordAuditEvent({ action: "LOGIN_FAILURE", entityType: "user", result: "FAILURE", metadata: { username } });
      return { ok: false, message: "نام کاربری یا رمز عبور اشتباه است." };
    }
    const captchaToken = String(formData.get("turnstileToken") || "");
    if (!captchaToken && process.env.NODE_ENV === "production") return { ok: false, message: "تأیید امنیتی انجام نشد؛ دوباره تلاش کنید." };
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.auth.signInWithPassword({ email, password, options: { captchaToken: captchaToken || undefined } });
    if (error || !data.user) {
      await recordAuditEvent({ action: "LOGIN_FAILURE", entityType: "user", userId: profile?.id, result: "FAILURE", metadata: { username } });
      return { ok: false, message: "نام کاربری یا رمز عبور اشتباه است." };
    }
    await db.update(users).set({ emailVerified: Boolean(data.user.email_confirmed_at), updatedAt: new Date() } as any).where(eq(users.id, data.user.id));
    await recordAuditEvent({ action: "LOGIN_SUCCESS", entityType: "user", entityId: data.user.id, userId: data.user.id, result: "SUCCESS" });
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

export async function requestPasswordResetAction(formData: FormData): Promise<void> {
  const email = String(formData.get("email") || "").trim().toLowerCase();
  if (/^\S+@\S+\.\S+$/.test(email)) {
    const supabase = await createSupabaseServerClient();
    await supabase.auth.resetPasswordForEmail(email, { redirectTo: `${canonicalSiteUrl()}/auth/callback?next=/update-password` });
  }
  redirect("/login?reset=sent");
}

export async function updatePasswordAction(formData: FormData): Promise<void> {
  const password = String(formData.get("password") || "");
  const confirm = String(formData.get("confirmPassword") || "");
  const policyError = validatePasswordPolicy(password);
  if (policyError || password !== confirm || password.length > 128) redirect("/update-password?error=invalid");
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.updateUser({ password });
  if (error) redirect("/update-password?error=failed");
  redirect("/settings?password=updated");
}

// ───────────── Update FX Rate (per-user, 24h limit) ─────────────

/**
 * Retired: manual rate entry was removed — the reference rate comes from the
 * live USDT/Toman market. Kept as a refusal so any stale caller fails loudly
 * instead of silently appearing to succeed.
 */
export async function updateFxRateAction(): Promise<AuthResult> {
  return { ok: false, message: "نرخ مرجع از بازار زنده خوانده می‌شود و دستی قابل ثبت نیست." };
}

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
