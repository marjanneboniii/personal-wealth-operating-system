"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth";
import { normalizeNumericInput } from "@/lib/numericInput";
import type { ActionResult } from "@/app/actions";
import {
  createHistoryRecord,
  deleteHistoryRecord,
  updateHistoryRecord,
  type HistoryInput,
} from "@/features/history/service";

/**
 * سوابق پیش از توازن — none of these write the ledger. A history record is a
 * note about the past; balances, net worth and reports never read it.
 */

async function signedIn() {
  try {
    return (await getCurrentUser()) ?? null;
  } catch {
    return null;
  }
}

function refresh() {
  for (const p of ["/transactions/history", "/transactions"]) revalidatePath(p);
}

const s = (fd: FormData, k: string) => {
  const v = fd.get(k);
  return typeof v === "string" ? v : "";
};

function inputOf(fd: FormData): HistoryInput {
  return {
    occurredOn: s(fd, "occurredOn"),
    kind: s(fd, "kind"),
    title: s(fd, "title"),
    amount: normalizeNumericInput(s(fd, "amount"), { decimal: true }) || "0",
    unit: s(fd, "unit") || "IRT",
    counterparty: s(fd, "counterparty") || null,
    accountLabel: s(fd, "accountLabel") || null,
    note: s(fd, "note") || null,
  };
}

const UUID = /^[0-9a-f-]{36}$/i;

export async function saveHistoryRecordAction(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const user = await signedIn();
  if (!user?.id) return { ok: false, message: "برای ثبت سابقه وارد شوید." };
  const id = s(fd, "id");
  if (id && !UUID.test(id)) return { ok: false, message: "سابقه یافت نشد." };
  try {
    if (id) await updateHistoryRecord(user.id, id, inputOf(fd));
    else await createHistoryRecord(user.id, inputOf(fd));
    refresh();
    return { ok: true, message: id ? "سابقه به‌روز شد." : "سابقه ثبت شد؛ موجودی حساب‌ها تغییری نکرد." };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "خطا در ثبت سابقه" };
  }
}

export async function deleteHistoryRecordAction(id: string): Promise<ActionResult> {
  const user = await signedIn();
  if (!user?.id) return { ok: false, message: "برای حذف سابقه وارد شوید." };
  if (!UUID.test(id)) return { ok: false, message: "سابقه یافت نشد." };
  try {
    await deleteHistoryRecord(user.id, id);
    refresh();
    return { ok: true, message: "سابقه حذف شد." };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "خطا" };
  }
}
