/** Only public availability information leaves the server, never key material. */
export function smsConnectionConfig(siteUrl = process.env.NEXT_PUBLIC_SITE_URL, encryptionKey = process.env.FIELD_ENCRYPTION_KEY) {
  let endpoint: string | null = null;
  try {
    const url = new URL(siteUrl || "");
    if (url.protocol === "https:" && !url.username && !url.password) endpoint = new URL("/api/bank-messages", url.origin).href;
  } catch {}
  if (!endpoint) return { endpoint: null, unavailableReason: "آدرس امن دریافت پیام در این نسخه آماده نیست. پس از آماده‌شدن سرویس، می‌توانید اتصال را ادامه دهید." };
  if (!encryptionKey?.trim() || Buffer.from(encryptionKey.trim(), "base64").length !== 32) return { endpoint, unavailableReason: "سرویس نگهداری امن پیام‌ها در این نسخه آماده نیست. ساخت کلید فعلاً در دسترس نیست؛ تنظیمات آیفون شما علت این مشکل نیست." };
  return { endpoint, unavailableReason: null };
}
