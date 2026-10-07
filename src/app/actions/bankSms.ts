"use server";
import { getSetupReadyUser } from "@/lib/authGuard";

import { smsConnectionConfig } from "@/features/bankImport/connectionConfig";
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import { bankSmsConnections, bankSmsInbox } from "@/db/schema";
import { createSmsConnection, getSmsInboxItem, requireSmsSetup, SmsError } from "@/features/bankImport/sms";

export async function createIphoneConnectionAction(input: unknown) {
  try {
    const user = await getSetupReadyUser();
    if (!user) return { ok: false as const, message: "ابتدا وارد شوید." };
    const availability = smsConnectionConfig();
    if (availability.unavailableReason) return { ok: false as const, message: availability.unavailableReason };
    const parsed = z.object({ name: z.string().trim().min(1).max(60), consent: z.literal(true) }).safeParse(input);
    if (!parsed.success) return { ok: false as const, message: "نام دستگاه و رضایت ارسال پیامک‌های بانکی لازم است." };
    const connection = await createSmsConnection(user.id, parsed.data.name);
    revalidatePath("/transactions/import");
    revalidatePath("/setup/messages");
    return { ok: true as const, token: connection.token, message: "کلید ساخته شد؛ فقط همین بار نمایش داده می‌شود." };
  } catch (error) {
    return { ok: false as const, message: error instanceof SmsError && error.code === "SETUP_REQUIRED" ? "ابتدا راه‌اندازی اولیه توازن را کامل کنید." : error instanceof SmsError && error.code === "CONNECTION_LIMIT" ? "۵ دستگاه کلید دارند. ابتدا کلید دستگاه قدیمی را لغو کنید." : "ساخت اتصال انجام نشد؛ کمی بعد دوباره تلاش کنید." };
  }
}

export async function revokeIphoneConnectionAction(id: string) {
  try {
    const user = await getSetupReadyUser();
    if (!user || !z.uuid().safeParse(id).success) return { ok: false, message: "دسترسی مجاز نیست." };
    await requireSmsSetup(user.id);
    const rows = await db.update(bankSmsConnections).set({ revokedAt: new Date() }).where(and(eq(bankSmsConnections.id, id), eq(bankSmsConnections.userId, user.id))).returning({ id: bankSmsConnections.id });
    revalidatePath("/transactions/import");
    revalidatePath("/setup/messages");
    return { ok: !!rows.length, message: rows.length ? "اتصال لغو شد؛ اتوماسیون را در Shortcuts نیز خاموش کنید." : "اتصال پیدا نشد." };
  } catch { return { ok: false, message: "لغو اتصال انجام نشد." }; }
}

export async function rejectBankSmsAction(id: string) {
  try {
    const user = await getSetupReadyUser();
    if (!user || !z.uuid().safeParse(id).success) return { ok: false, message: "دسترسی مجاز نیست." };
    await requireSmsSetup(user.id);
    const row = await getSmsInboxItem(user.id, id);
    if (!row) return { ok: false, message: "پیام پیدا نشد." };
    const changed = await db.update(bankSmsInbox).set({ status: "rejected", encryptedPayload: null }).where(and(eq(bankSmsInbox.id, id), eq(bankSmsInbox.userId, user.id), eq(bankSmsInbox.status, "pending"))).returning({ id: bankSmsInbox.id });
    revalidatePath("/transactions/import");
    revalidatePath("/setup/messages");
    return { ok: !!changed.length, message: changed.length ? "پیام رد و متن آن حذف شد." : "این پیام ثبت شده یا در حال ثبت است؛ صفحه را تازه‌سازی کنید." };
  } catch { return { ok: false, message: "رد پیام انجام نشد." }; }
}
