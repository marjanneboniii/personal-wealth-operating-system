"use server";

import QRCode from "qrcode";
import { cookies } from "next/headers";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { userTotpCredentials } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { checkRateLimit } from "@/lib/rateLimit";
import { encryptTotpSecret, decryptTotpSecret, generateTotpSecret, provisioningUri, verifyTotp } from "@/lib/totp";

export type TwoFactorResult = { ok: boolean; message: string; qrDataUrl?: string; manualKey?: string; setup?: boolean };
const COOKIE = "pwos_totp_setup";

export async function beginTwoFactorSetup(): Promise<TwoFactorResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, message: "ابتدا وارد حساب خود شوید." };
  if (!checkRateLimit(`2fa-setup:${user.id}`, 5, 300).ok) return { ok: false, message: "لطفاً چند دقیقه دیگر دوباره تلاش کنید." };
  try {
    const [existing] = await db.select({ userId: userTotpCredentials.userId }).from(userTotpCredentials).where(eq(userTotpCredentials.userId, user.id)).limit(1);
    if (existing) return { ok: false, message: "تأیید دو مرحله‌ای از قبل فعال است." };
    const secret = generateTotpSecret();
    const encrypted = encryptTotpSecret(secret);
    const store = await cookies();
    store.set(COOKIE, encrypted, { httpOnly: true, sameSite: "strict", secure: process.env.NODE_ENV === "production", path: "/settings", maxAge: 600 });
    const account = user.email || user.username || user.name;
    const qrDataUrl = await QRCode.toDataURL(provisioningUri(secret, account), { width: 240, margin: 2, errorCorrectionLevel: "M" });
    return { ok: true, message: "کد QR را اسکن و سپس کد ۶ رقمی را وارد کنید.", qrDataUrl, manualKey: secret, setup: true };
  } catch {
    return { ok: false, message: "راه‌اندازی تأیید دو مرحله‌ای در دسترس نیست." };
  }
}

export async function confirmTwoFactorSetup(_previous: TwoFactorResult | null, formData: FormData): Promise<TwoFactorResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, message: "ابتدا وارد حساب خود شوید." };
  if (!checkRateLimit(`2fa-confirm:${user.id}`, 10, 300).ok) return { ok: false, message: "تعداد تلاش‌ها بیش از حد مجاز است." };
  try {
    const store = await cookies();
    const encrypted = store.get(COOKIE)?.value;
    if (!encrypted) return { ok: false, message: "زمان راه‌اندازی به پایان رسیده است. دوباره شروع کنید." };
    const secret = decryptTotpSecret(encrypted);
    if (!verifyTotp(secret, String(formData.get("totpCode") || ""))) {
      return { ok: false, message: "کد واردشده صحیح نیست.", setup: true };
    }
    await db.insert(userTotpCredentials).values({ userId: user.id, secretEncrypted: encryptTotpSecret(secret) }).onConflictDoNothing();
    store.delete(COOKIE);
    return { ok: true, message: "تأیید دو مرحله‌ای با موفقیت فعال شد." };
  } catch {
    return { ok: false, message: "فعال‌سازی انجام نشد. لطفاً دوباره تلاش کنید." };
  }
}
