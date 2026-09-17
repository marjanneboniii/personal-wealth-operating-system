"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import { bankSmsConnections, bankSmsInbox } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { createSmsConnection, getSmsInboxItem, requireSmsSetup, SmsError } from "@/features/bankImport/sms";

export async function createIphoneConnectionAction(input: unknown) {
  try {
    const user = await getCurrentUser();
    if (!user) return { ok: false as const, message: "ابتدا وارد شوید." };
    const site = new URL(process.env.NEXT_PUBLIC_SITE_URL || "");
    if (site.protocol !== "https:") return { ok: false as const, message: "آدرس امن اتصال هنوز آماده نیست." };
    const parsed = z.object({ name: z.string().trim().min(1).max(60), consent: z.literal(true) }).safeParse(input);
    if (!parsed.success) return { ok: false as const, message: "نام دستگاه و رضایت ارسال پیامک‌های بانکی لازم است." };
    const connection = await createSmsConnection(user.id, parsed.data.name);
    revalidatePath("/transactions/import");
    return { ok: true as const, token: connection.token, message: "کلید ساخته شد؛ فقط همین بار نمایش داده می‌شود." };
  } catch (error) {
    return { ok: false as const, message: error instanceof SmsError && error.code === "SETUP_REQUIRED" ? "ابتدا راه‌اندازی اولیه توازن را کامل کنید." : "ساخت اتصال ممکن نشد؛ تنظیم رمزگذاری و سقف پنج دستگاه را بررسی کنید." };
  }
}

export async function revokeIphoneConnectionAction(id: string) {
  try {
    const user = await getCurrentUser();
    if (!user || !z.uuid().safeParse(id).success) return { ok: false, message: "دسترسی مجاز نیست." };
    await requireSmsSetup(user.id);
    const rows = await db.update(bankSmsConnections).set({ revokedAt: new Date() }).where(and(eq(bankSmsConnections.id, id), eq(bankSmsConnections.userId, user.id))).returning({ id: bankSmsConnections.id });
    revalidatePath("/transactions/import");
    return { ok: !!rows.length, message: rows.length ? "اتصال لغو شد؛ اتوماسیون را در Shortcuts نیز خاموش کنید." : "اتصال پیدا نشد." };
  } catch { return { ok: false, message: "لغو اتصال انجام نشد." }; }
}

export async function rejectBankSmsAction(id: string) {
  try {
    const user = await getCurrentUser();
    if (!user || !z.uuid().safeParse(id).success) return { ok: false, message: "دسترسی مجاز نیست." };
    await requireSmsSetup(user.id);
    const row = await getSmsInboxItem(user.id, id);
    if (!row) return { ok: false, message: "پیام پیدا نشد." };
    const changed = await db.update(bankSmsInbox).set({ status: "rejected", encryptedPayload: null }).where(and(eq(bankSmsInbox.id, id), eq(bankSmsInbox.userId, user.id), eq(bankSmsInbox.status, "pending"))).returning({ id: bankSmsInbox.id });
    revalidatePath("/transactions/import");
    return { ok: !!changed.length, message: changed.length ? "پیام رد و متن آن حذف شد." : "این پیام ثبت شده یا در حال ثبت است؛ صفحه را تازه‌سازی کنید." };
  } catch { return { ok: false, message: "رد پیام انجام نشد." }; }
}
