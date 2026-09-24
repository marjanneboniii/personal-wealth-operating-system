"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import type { ActionResult } from "@/app/actions";
import { addDueDate, cancelDueDate, completeDueDate } from "@/features/vehicles/service";

/** A car's due dates are reminders — none of these write the ledger. */

async function signedIn() {
  try {
    return (await getCurrentUser()) ?? null;
  } catch {
    return null;
  }
}

function refresh() {
  for (const p of ["/vehicles", "/notifications", "/"]) revalidatePath(p);
}

export async function addDueDateAction(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const user = await signedIn();
  if (!user?.id) return { ok: false, message: "وارد شوید." };
  const vehicleId = String(fd.get("vehicleId") ?? "");
  if (!z.uuid().safeParse(vehicleId).success) return { ok: false, message: "خودرو را انتخاب کنید." };
  const repeat = Number(fd.get("repeatMonths") ?? "");
  try {
    await addDueDate(user.id, {
      vehicleId,
      kind: String(fd.get("kind") ?? ""),
      title: String(fd.get("title") ?? "") || null,
      dueDate: String(fd.get("dueDate") ?? ""),
      repeatMonths: Number.isFinite(repeat) && repeat > 0 ? repeat : null,
    });
    refresh();
    return { ok: true, message: "سررسید ثبت شد و در یادآورها می‌آید." };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "ثبت نشد." };
  }
}

export async function completeDueDateAction(id: string): Promise<ActionResult> {
  const user = await signedIn();
  if (!user?.id || !z.uuid().safeParse(id).success) return { ok: false, message: "وارد شوید." };
  try {
    const next = await completeDueDate(user.id, id);
    refresh();
    return { ok: true, message: next ? "انجام شد؛ سررسید دوره‌ی بعد ثبت شد." : "انجام شد." };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "خطا" };
  }
}

export async function cancelDueDateAction(id: string): Promise<ActionResult> {
  const user = await signedIn();
  if (!user?.id || !z.uuid().safeParse(id).success) return { ok: false, message: "وارد شوید." };
  try {
    await cancelDueDate(user.id, id);
    refresh();
    return { ok: true, message: "سررسید حذف شد." };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "خطا" };
  }
}
