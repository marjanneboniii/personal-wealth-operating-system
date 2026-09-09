import { NextResponse } from "next/server";
import { db } from "@/db";
import { users, userFxSettings } from "@/db/schema";
import { eq } from "drizzle-orm";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const next = url.searchParams.get("next");
  const destination = next?.startsWith("/") && !next.startsWith("//") ? next : "/";
  if (!code) return NextResponse.redirect(new URL("/login?error=callback", url.origin));

  const supabase = await createClient();
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);
  if (error || !data.user) return NextResponse.redirect(new URL("/login?error=callback", url.origin));

  const email = data.user.email?.toLowerCase() ?? null;
  const metadata = data.user.user_metadata ?? {};
  const ownerEmail = process.env.PWOS_BOOTSTRAP_OWNER_EMAIL?.trim().toLowerCase();
  // Bootstrap privilege is granted only after Supabase has completed a
  // verified email/OAuth callback. Merely submitting the owner's address to
  // public signup can never grant this role.
  const role = ownerEmail && email === ownerEmail && data.user.email_confirmed_at ? "owner" : "user";
  await db.insert(users).values({
    id: data.user.id,
    name: String(metadata.name || metadata.full_name || email?.split("@")[0] || "کاربر").slice(0, 120),
    username: typeof metadata.username === "string" ? metadata.username.slice(0, 64) : null,
    email,
    emailVerified: Boolean(data.user.email_confirmed_at),
    role,
  } as any).onConflictDoUpdate({
    target: users.id,
    set: { email, emailVerified: Boolean(data.user.email_confirmed_at), updatedAt: new Date() } as any,
  });
  if (role === "owner") {
    await db.update(users).set({ role: "owner", updatedAt: new Date() } as any).where(eq(users.id, data.user.id));
  }
  await db.insert(userFxSettings).values({ userId: data.user.id, currentRate: "190000" }).onConflictDoNothing();
  return NextResponse.redirect(new URL(destination, url.origin));
}
