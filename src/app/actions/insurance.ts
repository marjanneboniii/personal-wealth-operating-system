"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { normalizeNumericInput } from "@/lib/numericInput";
import type { ActionResult } from "@/app/actions";
import { cancelPolicy, createPolicy, deletePolicy, renewPolicy } from "@/features/insurance/service";

/**
 * بیمه‌نامه‌ها — none of these write the ledger. A premium is recorded from its
 * reminder as an ordinary expense (or a transfer into a life policy's savings).
 */

async function signedIn() {
  try {
    return (await getCurrentUser()) ?? null;
  } catch {
    return null;
  }
}

function refresh() {
  for (const p of ["/insurance", "/planning", "/notifications", "/insights", "/accounts", "/"]) revalidatePath(p);
}

const s = (fd: FormData, k: string) => {
  const v = fd.get(k);
  return typeof v === "string" ? v : "";
};
const uuidOrNull = (v: string) => (z.uuid().safeParse(v).success ? v : null);

export async function createPolicyAction(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const user = await signedIn();
  if (!user?.id) return { ok: false, message: "برای ثبت بیمه‌نامه وارد شوید." };
  try {
    await createPolicy(user.id, {
      kind: s(fd, "kind"),
      title: s(fd, "title"),
      insurer: s(fd, "insurer") || null,
      policyNumber: s(fd, "policyNumber") || null,
      startDate: s(fd, "startDate"),
      endDate: s(fd, "endDate") || null,
      premiumToman: normalizeNumericInput(s(fd, "premiumToman")) || "0",
      premiumFrequency: s(fd, "premiumFrequency"),
      payAccountId: s(fd, "payAccountId"),
      coverageToman: normalizeNumericInput(s(fd, "coverageToman")) || null,
      insuredPropertyId: uuidOrNull(s(fd, "insuredPropertyId")),
      insuredVehicleId: uuidOrNull(s(fd, "insuredVehicleId")),
      withSavings: s(fd, "withSavings") === "yes",
      note: s(fd, "note") || null,
    });
    refresh();
    return { ok: true, message: "بیمه‌نامه ثبت شد؛ حق بیمه و سررسید تمدید در یادآورها می‌آید." };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "ثبت بیمه‌نامه انجام نشد." };
  }
}

export async function renewPolicyAction(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const user = await signedIn();
  if (!user?.id) return { ok: false, message: "وارد شوید." };
  const id = uuidOrNull(s(fd, "id"));
  if (!id) return { ok: false, message: "بیمه‌نامه معتبر نیست." };
  try {
    await renewPolicy(user.id, id, {
      startDate: s(fd, "startDate") || null,
      endDate: s(fd, "endDate"),
      premiumToman: normalizeNumericInput(s(fd, "premiumToman")) || "0",
      coverageToman: normalizeNumericInput(s(fd, "coverageToman")) || null,
    });
    refresh();
    return { ok: true, message: "بیمه‌نامه تمدید شد." };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "تمدید انجام نشد." };
  }
}

export async function cancelPolicyAction(id: string): Promise<ActionResult> {
  const user = await signedIn();
  if (!user?.id || !uuidOrNull(id)) return { ok: false, message: "وارد شوید." };
  try {
    await cancelPolicy(user.id, id);
    refresh();
    return { ok: true, message: "بیمه‌نامه لغو شد." };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "خطا" };
  }
}

export async function deletePolicyAction(id: string): Promise<ActionResult> {
  const user = await signedIn();
  if (!user?.id || !uuidOrNull(id)) return { ok: false, message: "وارد شوید." };
  try {
    await deletePolicy(user.id, id);
    refresh();
    return { ok: true, message: "بیمه‌نامه حذف شد." };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "خطا" };
  }
}
