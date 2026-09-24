"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { normalizeNumericInput } from "@/lib/numericInput";
import { todayIso } from "@/lib/format";
import type { ActionResult } from "@/app/actions";
import { adjustToReported, recordBalanceCheckpoint } from "@/features/reconcile/service";

/**
 * تطبیق موجودی — recording what the bank says writes no ledger row; closing a
 * difference posts one balanced adjustment entry, and only on an explicit tap.
 */

async function signedIn() {
  try {
    return (await getCurrentUser()) ?? null;
  } catch {
    return null;
  }
}

function refresh() {
  for (const p of ["/accounts", "/accounts/reconcile", "/notifications", "/transactions", "/"]) revalidatePath(p);
}

export async function recordBankBalanceAction(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const user = await signedIn();
  if (!user?.id) return { ok: false, message: "برای تطبیق موجودی وارد شوید." };
  const accountId = String(fd.get("accountId") ?? "");
  if (!z.uuid().safeParse(accountId).success) return { ok: false, message: "حساب را انتخاب کنید." };
  const raw = normalizeNumericInput(String(fd.get("balance") ?? ""), { decimal: true });
  const negative = String(fd.get("negative") ?? "") === "yes";
  if (!raw) return { ok: false, message: "موجودی واقعی حساب را وارد کنید." };
  const asOf = String(fd.get("asOf") ?? "") || todayIso();
  try {
    await recordBalanceCheckpoint({ userId: user.id, accountId, asOf, balance: negative ? `-${raw}` : raw, source: "manual" });
    refresh();
    return { ok: true, message: "موجودی بانک ثبت شد." };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "ثبت موجودی انجام نشد." };
  }
}

export async function adjustToBankAction(checkpointId: string): Promise<ActionResult> {
  const user = await signedIn();
  if (!user?.id) return { ok: false, message: "وارد شوید." };
  if (!z.uuid().safeParse(checkpointId).success) return { ok: false, message: "درخواست معتبر نیست." };
  try {
    await adjustToReported(user.id, checkpointId);
    refresh();
    return { ok: true, message: "سند اصلاحی ثبت شد و حساب با بانک یکی شد." };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "اصلاح انجام نشد." };
  }
}
