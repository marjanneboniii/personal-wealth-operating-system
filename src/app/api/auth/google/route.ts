import { NextResponse } from "next/server";
import { db } from "@/db";
import { users, userFxSettings } from "@/db/schema";
import { eq, or } from "drizzle-orm";
import { createSession, setSessionCookie } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * Google login/registration
 * Body: { idToken?: string, email: string, name?: string, googleId: string, picture?: string }
 * If GOOGLE_CLIENT_ID is set, verify idToken via Google tokeninfo endpoint.
 * Otherwise trust payload for demo/testing (still checks email uniqueness).
 * Linking: if email matches existing user without googleId, link it. No duplicate.
 */
export async function POST(req: Request) {
  try {
    const body = await req.json();
    let email: string | null = body.email?.trim() || null;
    let googleId: string | null = body.googleId?.trim() || body.sub?.trim() || null;
    let name: string | null = body.name?.trim() || body.given_name || null;
    const idToken: string | null = body.idToken || null;

    // Verify via Google if token provided and client ID configured
    const clientId = process.env.GOOGLE_CLIENT_ID;
    if (idToken && clientId) {
      try {
        const verifyRes = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`);
        if (!verifyRes.ok) {
          return NextResponse.json({ ok: false, error: "توکن Google نامعتبر است." }, { status: 401 });
        }
        const info = await verifyRes.json();
        if (info.aud !== clientId) {
          return NextResponse.json({ ok: false, error: "توکن برای این اپ نیست." }, { status: 401 });
        }
        if (info.email_verified !== "true" && info.email_verified !== true) {
          return NextResponse.json({ ok: false, error: "ایمیل Google تأیید نشده است." }, { status: 401 });
        }
        email = (info.email as string) || email;
        googleId = (info.sub as string) || googleId;
        name = (info.name as string) || name;
      } catch (e) {
        return NextResponse.json({ ok: false, error: "خطا در تأیید توکن Google." }, { status: 401 });
      }
    } else if (idToken && !clientId) {
      // Demo mode: decode JWT payload without verification (for dev/test)
      try {
        const payload = JSON.parse(Buffer.from(idToken.split(".")[1], "base64url").toString());
        email = payload.email || email;
        googleId = payload.sub || googleId;
        name = payload.name || name;
      } catch {}
    }

    if (!email || !googleId) {
      return NextResponse.json({ ok: false, error: "اطلاعات Google ناقص است." }, { status: 400 });
    }
    email = email.toLowerCase();

    // 1. Check existing by googleId
    let [existingByGoogle] = await db.select().from(users).where(eq(users.googleId as any, googleId)).limit(1);
    if (existingByGoogle) {
      const { token, expiresAt } = await createSession(existingByGoogle.id);
      await setSessionCookie(token, expiresAt);
      return NextResponse.json({ ok: true, message: "ورود با Google موفق." });
    }

    // 2. Check existing by email — link Google identity, prevent duplicate
    let [existingByEmail] = await db.select().from(users).where(eq(users.email as any, email)).limit(1);
    if (existingByEmail) {
      // Link Google ID to existing user
      await db
        .update(users)
        .set({ googleId, emailVerified: true, updatedAt: new Date() } as any)
        .where(eq(users.id, existingByEmail.id));
      const { token, expiresAt } = await createSession(existingByEmail.id);
      await setSessionCookie(token, expiresAt);
      return NextResponse.json({ ok: true, message: "حساب Google به کاربر موجود متصل شد." });
    }

    // 3. Also check if email matches username? For migration, if legacy user has no email but we create new Google user, that's fine.
    // Check legacy owner without username: if single legacy exists, claim it with Google identity?
    // Instead, create new user for Google, but if only one legacy user exists and it has no username/email, we could claim?
    // For safety, if legacy user count ===1 and that user has no email/username, and total users ===1, we claim that user with Google.
    const allUsers = await db.select().from(users);
    const legacyCandidates = allUsers.filter((u: any) => !u.username && !u.email && !u.googleId);
    if (allUsers.length === 1 && legacyCandidates.length === 1) {
      const legacy = legacyCandidates[0];
      await db
        .update(users)
        .set({ googleId, email, name: name || legacy.name, emailVerified: true, updatedAt: new Date() } as any)
        .where(eq(users.id, legacy.id));
      try {
        await db.insert(userFxSettings).values({ userId: legacy.id, currentRate: "190000" }).onConflictDoNothing();
      } catch {}
      const { token, expiresAt } = await createSession(legacy.id);
      await setSessionCookie(token, expiresAt);
      return NextResponse.json({ ok: true, message: "حساب Google به مالک فعلی متصل شد." });
    }

    // 4. Create new user for Google
    const usernameBase = email.split("@")[0].replace(/[^a-z0-9_]/gi, "_").toLowerCase();
    let username = usernameBase;
    let suffix = 1;
    while (true) {
      const [exists] = await db.select().from(users).where(eq(users.username as any, username)).limit(1);
      if (!exists) break;
      username = `${usernameBase}${suffix++}`;
    }

    const [newUser] = await db
      .insert(users)
      .values({
        name: name || username,
        username,
        email,
        googleId,
        emailVerified: true,
        role: "owner",
      } as any)
      .returning();
    try {
      await db.insert(userFxSettings).values({ userId: newUser.id, currentRate: "190000" }).onConflictDoNothing();
    } catch {}
    const { token, expiresAt } = await createSession(newUser.id);
    await setSessionCookie(token, expiresAt);
    return NextResponse.json({ ok: true, message: "ثبت‌نام با Google موفق." });
  } catch (e) {
    console.error("[google auth]", e);
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "خطای سرور" }, { status: 500 });
  }
}
