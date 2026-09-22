"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth";
import { normalizeNumericInput } from "@/lib/numericInput";
import type { ActionResult } from "@/app/actions";
import { createCheque, deleteCheque, setChequeStatus, type ChequeStatus } from "@/features/cheques/service";

/**
 * دفتر چک — registering and re-stating cheques. None of these write the
 * ledger: a cheque posts only when cleared through the transaction form.
 */

async function signedIn() {
  try {
    return (await getCurrentUser()) ?? null;
  } catch {
    return null;
  }
}

function refresh() {
  for (const p of ["/debts/cheques", "/planning", "/notifications", "/"]) revalidatePath(p);
}

const s = (fd: FormData, k: string) => {
  const v = fd.get(k);
  return typeof v === "string" ? v : "";
};

export async function createChequeAction(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const user = await signedIn();
  if (!user?.id) return { ok: false, message: "برای ثبت چک وارد شوید." };
  const direction = s(fd, "direction");
  if (direction !== "issued" && direction !== "received") return { ok: false, message: "نوع چک را انتخاب کنید." };
  try {
    await createCheque(user.id, {
      direction,
      counterparty: s(fd, "counterparty"),
      amountToman: normalizeNumericInput(s(fd, "amountToman"), { decimal: false }) || "0",
      dueDate: s(fd, "dueDate"),
      accountId: s(fd, "accountId") || null,
      sayadId: s(fd, "sayadId") || null,
      serial: s(fd, "serial") || null,
      bankName: s(fd, "bankName") || null,
      installmentId: s(fd, "installmentId") || null,
      note: s(fd, "note") || null,
    });
    refresh();
    return { ok: true, message: direction === "issued" ? "چک صادره ثبت شد." : "چک دریافتی ثبت شد." };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "خطا در ثبت چک" };
  }
}

export async function setChequeStatusAction(id: string, next: ChequeStatus, dueDate?: string | null): Promise<ActionResult> {
  const user = await signedIn();
  if (!user?.id) return { ok: false, message: "برای تغییر وضعیت چک وارد شوید." };
  if (!["pending", "bounced", "cancelled"].includes(next)) return { ok: false, message: "وضعیت نامعتبر است." };
  try {
    await setChequeStatus(user.id, id, next, dueDate ?? null);
    refresh();
    return { ok: true, message: "وضعیت چک به‌روز شد." };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "خطا" };
  }
}

export async function deleteChequeAction(id: string): Promise<ActionResult> {
  const user = await signedIn();
  if (!user?.id) return { ok: false, message: "برای حذف چک وارد شوید." };
  try {
    await deleteCheque(user.id, id);
    refresh();
    return { ok: true, message: "چک حذف شد." };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "خطا" };
  }
}
