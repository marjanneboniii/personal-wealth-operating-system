import { NextResponse } from "next/server";
import { db } from "@/db";
import { users, userFxSettings, userTotpCredentials } from "@/db/schema";
import { signChallenge } from "@/lib/totp";
import { eq } from "drizzle-orm";
import { createSession, setSessionCookie, getCurrentUserFromRequest } from "@/lib/auth";
import { checkRateLimit, getClientIp } from "@/lib/rateLimit";
import { recordAuditEvent } from "@/lib/audit";
import { verifyTurnstile } from "@/lib/turnstile";

/**
 * SECURITY: self-service Google sign-up always receives the low-privilege
 * role. Privileged roles are backend-assigned only; the request body cannot
 * influence the role (no `role` field is ever read from the client).
 */
const DEFAULT_GOOGLE_ROLE = "user";

export const dynamic = "force-dynamic";

/**
 * Real Google OAuth login/registration endpoint.
 * Requires a valid Google ID Token verified against Google's tokeninfo endpoint.
 * Validates aud, iss, sub, email, and email_verified.
 * Prevents account takeover by requiring active session authentication before linking to an existing email account.
 */
export async function POST(req: Request) {
  try {
    // A Google OAuth client id is public by design. Accept the public-prefixed
    // variable too so the browser button and server verifier cannot drift.
    const clientId = process.env.GOOGLE_CLIENT_ID || process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;
    if (!clientId || clientId.trim() === "") {
      return NextResponse.json(
        { ok: false, error: "Google authentication is not configured." },
        { status: 503 }
      );
    }

    let body: Record<string, unknown>;
    try {
      body = (await req.json()) as Record<string, unknown>;
    } catch {
      return NextResponse.json({ ok: false, error: "درخواست ورود Google نامعتبر است." }, { status: 400 });
    }
    const idToken: string | null = (typeof body.idToken === "string" && body.idToken) || (typeof body.credential === "string" && body.credential) || null;
    const captcha = await verifyTurnstile(String(body.turnstileToken || ""), getClientIp(req));
    if (!captcha.ok) return NextResponse.json({ ok: false, error: captcha.message }, { status: 400 });

    if (!idToken) {
      return NextResponse.json({ ok: false, error: "توکن Google ارائه نشده است." }, { status: 401 });
    }

    // Verify token via Google tokeninfo endpoint
    let info: Record<string, unknown>;
    try {
      // POST keeps the JWT out of the URL (length limits / access logs).
      const verifyRes = await fetch("https://oauth2.googleapis.com/tokeninfo", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ id_token: idToken }),
        cache: "no-store",
      });
      if (!verifyRes.ok) {
        return NextResponse.json({ ok: false, error: "توکن Google نامعتبر است." }, { status: 401 });
      }
      info = await verifyRes.json();
    } catch (e) {
      return NextResponse.json({ ok: false, error: "خطا در تأیید توکن Google." }, { status: 401 });
    }

    // Security Hardening: strict validation of aud, iss, sub, email, email_verified, expiration
    if (info.aud !== clientId) {
      return NextResponse.json({ ok: false, error: "توکن برای این اپ نیست." }, { status: 401 });
    }

    const iss = String(info.iss || "");
    if (iss !== "https://accounts.google.com" && iss !== "accounts.google.com") {
      return NextResponse.json({ ok: false, error: "صادرکننده توکن Google نامعتبر است." }, { status: 401 });
    }

    if (!info.sub || typeof info.sub !== "string") {
      return NextResponse.json({ ok: false, error: "شناسه حساب Google نامعتبر است." }, { status: 401 });
    }

    // Expiration check: exp is seconds since epoch (Google tokeninfo)
    if (info.exp !== undefined && info.exp !== null) {
      const expNum = Number(info.exp);
      if (!Number.isFinite(expNum) || expNum * 1000 < Date.now()) {
        return NextResponse.json({ ok: false, error: "توکن Google منقضی شده است." }, { status: 401 });
      }
    } else if (info.expires_in !== undefined) {
      const expiresIn = Number(info.expires_in);
      if (Number.isFinite(expiresIn) && expiresIn <= 0) {
        return NextResponse.json({ ok: false, error: "توکن Google منقضی شده است." }, { status: 401 });
      }
    }

    if (info.email_verified !== "true" && info.email_verified !== true) {
      return NextResponse.json({ ok: false, error: "ایمیل Google تأیید نشده است." }, { status: 401 });
    }

    if (!info.email || typeof info.email !== "string") {
      return NextResponse.json({ ok: false, error: "ایمیل Google نامعتبر است." }, { status: 400 });
    }

    const email = info.email.toLowerCase().trim();
    const googleId = info.sub.trim();
    const name = typeof info.name === "string" && info.name.trim() ? info.name.trim() : email.split("@")[0];

    // Rate limit per email identity and per client IP
    const clientIp = getClientIp(req);
    if (!checkRateLimit(`google:${email}`, 20, 60).ok || !checkRateLimit(`google-ip:${clientIp}`, 30, 60).ok) {
      return NextResponse.json(
        { ok: false, error: "تعداد تلاش‌ها بیش از حد مجاز است. لطفاً کمی صبر کنید." },
        { status: 429 }
      );
    }

    // 1. Check existing user by googleId
    const [existingByGoogle] = await db.select().from(users).where(eq(users.googleId as any, googleId)).limit(1);
    if (existingByGoogle) {
      // Refresh verified state / timestamp
      await db
        .update(users)
        .set({ emailVerified: true, updatedAt: new Date() } as any)
        .where(eq(users.id, existingByGoogle.id));
      const [totp] = await db.select({ userId: userTotpCredentials.userId }).from(userTotpCredentials).where(eq(userTotpCredentials.userId, existingByGoogle.id)).limit(1);
      if (totp) {
        let challenge: string;
        try {
          challenge = signChallenge(existingByGoogle.id);
        } catch {
          return NextResponse.json(
            { ok: false, error: "ورود دو مرحله‌ای پیکربندی نشده است. TOTP_ENCRYPTION_KEY را در سرور تنظیم کنید." },
            { status: 503 },
          );
        }
        const response = NextResponse.json({ ok: false, requiresTwoFactor: true, error: "کد ۶ رقمی برنامه تأییدکننده را وارد کنید." }, { status: 401 });
        response.cookies.set("pwos_2fa_challenge", challenge, { httpOnly: true, sameSite: "strict", secure: process.env.NODE_ENV === "production", path: "/login", maxAge: 300 });
        return response;
      }
      const { token, expiresAt } = await createSession(existingByGoogle.id);
      await setSessionCookie(token, expiresAt);
      await recordAuditEvent({
        action: "OAUTH_LOGIN",
        entityType: "user",
        entityId: existingByGoogle.id,
        userId: existingByGoogle.id,
        result: "SUCCESS",
      });
      return NextResponse.json({ ok: true, message: "ورود با Google موفق." });
    }

    // 2. Check existing user by email
    const [existingByEmail] = await db.select().from(users).where(eq(users.email as any, email)).limit(1);
    if (existingByEmail) {
      // Prevent Account Takeover: DO NOT automatically link to an existing account with matching email.
      // Require the user to be currently authenticated as that account to link their Google account.
      // A broken existing session must not abort Google sign-in with a generic 500.
      let currentUser: Awaited<ReturnType<typeof getCurrentUserFromRequest>> = null;
      try {
        currentUser = await getCurrentUserFromRequest(req);
      } catch {
        currentUser = null;
      }
      if (currentUser && currentUser.id === existingByEmail.id) {
        await db
          .update(users)
          .set({ googleId, emailVerified: true, updatedAt: new Date() } as any)
          .where(eq(users.id, existingByEmail.id));
        const { token, expiresAt } = await createSession(existingByEmail.id);
        await setSessionCookie(token, expiresAt);
        await recordAuditEvent({
          action: "OAUTH_LOGIN",
          entityType: "user",
          entityId: existingByEmail.id,
          userId: existingByEmail.id,
          result: "SUCCESS",
        });
        return NextResponse.json({ ok: true, message: "حساب Google به کاربر موجود متصل شد." });
      }

      // Audit the blocked takeover attempt (unauthenticated Google login
      // presenting the email of an existing account).
      try {
        await recordAuditEvent({
          action: "OAUTH_TAKEOVER_DENIED",
          entityType: "user",
          entityId: existingByEmail.id,
          userId: existingByEmail.id,
          result: "FAILURE",
          metadata: { email, googleId },
        });
      } catch {}

      return NextResponse.json(
        {
          ok: false,
          error:
            "حساب کاربری با این ایمیل وجود دارد. برای اتصال حساب Google، ابتدا با نام کاربری و رمز عبور وارد شوید.",
        },
        { status: 409 }
      );
    }

    // 3. Create new user for Google account
    const usernameBase = email.split("@")[0].replace(/[^a-z0-9_]/gi, "_").toLowerCase();
    let username = usernameBase;
    let suffix = 1;
    while (true) {
      const [exists] = await db.select().from(users).where(eq(users.username as any, username)).limit(1);
      if (!exists) break;
      username = `${usernameBase}${suffix++}`;
    }

    // Role is assigned by the backend only — public Google sign-up never
    // receives owner/admin privileges.
    const [newUser] = await db
      .insert(users)
      .values({
        name,
        username,
        email,
        googleId,
        emailVerified: true,
        role: DEFAULT_GOOGLE_ROLE,
      } as any)
      .returning();

    try {
      await db.insert(userFxSettings).values({ userId: newUser.id, currentRate: "190000" }).onConflictDoNothing();
    } catch {}

    const { token, expiresAt } = await createSession(newUser.id);
    await setSessionCookie(token, expiresAt);
    await recordAuditEvent({
      action: "OAUTH_LOGIN",
      entityType: "user",
      entityId: newUser.id,
      userId: newUser.id,
      result: "SUCCESS",
    });
    return NextResponse.json({ ok: true, message: "ثبت‌نام با Google موفق." });
  } catch (e) {
    const err = e as { code?: string; message?: string };
    const code = String(err?.code || "");
    const message = String(err?.message || "");
    console.warn("[google auth failure]", code || "no-code", message.slice(0, 180));
    if (code === "42703" || /column .* does not exist/i.test(message)) {
      return NextResponse.json({ ok: false, error: "ساختار پایگاه داده برای ورود Google کامل نیست. مهاجرت‌ها را اجرا کنید." }, { status: 503 });
    }
    if (code === "42P01" || /relation .* does not exist/i.test(message)) {
      return NextResponse.json({ ok: false, error: "جدول‌های پایگاه داده پیدا نشد. مهاجرت‌ها را اجرا کنید." }, { status: 503 });
    }
    if (code === "23505") {
      return NextResponse.json({ ok: false, error: "این حساب Google قبلاً ثبت شده است. دوباره تلاش کنید." }, { status: 409 });
    }
    if (code === "23502") {
      return NextResponse.json({ ok: false, error: "ثبت حساب Google به‌خاطر محدودیت پایگاه داده ناموفق بود." }, { status: 500 });
    }
    if (/TOTP encryption/i.test(message)) {
      return NextResponse.json({ ok: false, error: "ورود دو مرحله‌ای پیکربندی نشده است. TOTP_ENCRYPTION_KEY را در سرور تنظیم کنید." }, { status: 503 });
    }
    if (/Authentication\/Database error/i.test(message)) {
      return NextResponse.json({ ok: false, error: "ارتباط با پایگاه داده برقرار نشد. کمی بعد دوباره تلاش کنید." }, { status: 503 });
    }
    return NextResponse.json({ ok: false, error: "خطای سرور در احراز هویت Google." }, { status: 500 });
  }
}
