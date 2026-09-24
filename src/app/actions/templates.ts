"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import type { ActionResult } from "@/app/actions";
import { deleteTemplate, saveTemplateFromEntry } from "@/features/templates/service";

/** Shortcuts are presentation only — saving or deleting one never touches the ledger. */

async function signedIn() {
  try {
    return (await getCurrentUser()) ?? null;
  } catch {
    return null;
  }
}

export async function saveTemplateAction(entryId: string, label: string, keepAmount: boolean): Promise<ActionResult> {
  const user = await signedIn();
  if (!user?.id) return { ok: false, message: "وارد شوید." };
  if (!z.uuid().safeParse(entryId).success || typeof label !== "string") return { ok: false, message: "درخواست معتبر نیست." };
  try {
    await saveTemplateFromEntry(user.id, entryId, { label, keepAmount: !!keepAmount });
    revalidatePath("/");
    revalidatePath("/transactions");
    return { ok: true, message: "میان‌بر در صفحه‌ی اصلی اضافه شد." };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "ذخیره نشد." };
  }
}

export async function deleteTemplateAction(id: string): Promise<ActionResult> {
  const user = await signedIn();
  if (!user?.id || !z.uuid().safeParse(id).success) return { ok: false, message: "وارد شوید." };
  try {
    await deleteTemplate(user.id, id);
    revalidatePath("/");
    return { ok: true, message: "میان‌بر حذف شد." };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "حذف نشد." };
  }
}
