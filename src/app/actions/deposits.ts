"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth";
import { normalizeNumericInput } from "@/lib/numericInput";
import type { ActionResult } from "@/app/actions";
import { closeDeposit, createDeposit, deleteDeposit } from "@/features/deposits/service";

/**
 * سپرده‌ها — none of these write the ledger. The principal is already in an
 * account; the monthly interest is a reminder recorded with a tap.
 */

async function signedIn() {
  try {
    return (await getCurrentUser()) ?? null;
  } catch {
    return null;
  }
}

function refresh() {
  for (const p of ["/deposits", "/planning", "/notifications", "/"]) revalidatePath(p);
}

const s = (fd: FormData, k: string) => {
  const v = fd.get(k);
  return typeof v === "string" ? v : "";
};

export async function createDepositAction(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const user = await signedIn();
  if (!user?.id) return { ok: false, message: "برای ثبت سپرده وارد شوید." };
  const kind = s(fd, "kind");
  if (kind !== "bank" && kind !== "fund") return { ok: false, message: "نوع سپرده را انتخاب کنید." };
  try {
    await createDeposit(user.id, {
      kind,
      title: s(fd, "title"),
      institution: s(fd, "institution") || null,
      accountId: s(fd, "accountId"),
      payoutAccountId: s(fd, "payoutAccountId") || null,
      principalToman: normalizeNumericInput(s(fd, "principalToman")) || "0",
      annualRate: normalizeNumericInput(s(fd, "annualRate"), { decimal: true }) || "0",
      startDate: s(fd, "startDate"),
      maturityDate: s(fd, "maturityDate") || null,
      note: s(fd, "note") || null,
    });
    refresh();
    return { ok: true, message: "سپرده ثبت شد و سود ماهانه‌اش در یادآورها قرار گرفت." };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "خطا در ثبت سپرده" };
  }
}

export async function closeDepositAction(id: string): Promise<ActionResult> {
  const user = await signedIn();
  if (!user?.id) return { ok: false, message: "وارد شوید." };
  try {
    await closeDeposit(user.id, id);
    refresh();
    return { ok: true, message: "سپرده بسته شد." };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "خطا" };
  }
}

export async function deleteDepositAction(id: string): Promise<ActionResult> {
  const user = await signedIn();
  if (!user?.id) return { ok: false, message: "وارد شوید." };
  try {
    await deleteDeposit(user.id, id);
    refresh();
    return { ok: true, message: "سپرده حذف شد." };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "خطا" };
  }
}
