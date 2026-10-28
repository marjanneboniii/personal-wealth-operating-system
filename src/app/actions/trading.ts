"use server";
import { getSetupReadyUser } from "@/lib/authGuard";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { normalizeNumericInput } from "@/lib/numericInput";
import { formatMoney } from "@/lib/format";
import type { ActionResult } from "@/app/actions";
import { linkTradingAccount, recordTradingMark, syncTradingAccount, unlinkTradingAccount } from "@/features/trading/service";
import { D } from "@/domain/decimal";

/**
 * حساب معاملاتی — an update writes one balanced entry against «سود و زیان
 * سرمایه‌گذاری» only when the realized balance moved; the open P&L is a mark.
 */

async function signedIn() {
  try {
    return (await getSetupReadyUser()) ?? null;
  } catch {
    return null;
  }
}

function refresh() {
  for (const p of ["/accounts", "/transactions", "/reports", "/portfolio", "/net-worth", "/"]) revalidatePath(p);
}

function resultMessage(change: string): string {
  const d = D(change);
  if (d.isZero()) return "به‌روز شد. موجودی تحقق‌یافته تغییری نکرده بود؛ فقط سود و زیان باز ثبت شد.";
  return `به‌روز شد. ${d.isNegative() ? "زیان" : "سود"} تحقق‌یافتهٔ ${formatMoney(d.abs().toString())} در «سود و زیان سرمایه‌گذاری» ثبت شد.`;
}

export async function updateTradingAccountAction(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const user = await signedIn();
  if (!user?.id) return { ok: false, message: "وارد شوید." };
  const accountId = String(fd.get("accountId") ?? "");
  if (!z.uuid().safeParse(accountId).success) return { ok: false, message: "حساب را انتخاب کنید." };
  const value = normalizeNumericInput(String(fd.get("accountValue") ?? ""), { decimal: true });
  if (!value) return { ok: false, message: "ارزش حساب را از صفحهٔ پلتفرم وارد کنید." };
  const pnlRaw = normalizeNumericInput(String(fd.get("unrealizedPnl") ?? ""), { decimal: true }) || "0";
  const pnl = String(fd.get("pnlSign") ?? "") === "loss" ? `-${pnlRaw}` : pnlRaw;
  try {
    const { realizedChange } = await recordTradingMark(user.id, accountId, { accountValue: value, unrealizedPnl: pnl, source: "manual" });
    refresh();
    return { ok: true, message: resultMessage(realizedChange) };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "به‌روزرسانی انجام نشد." };
  }
}

export async function syncTradingAccountAction(accountId: string): Promise<ActionResult> {
  const user = await signedIn();
  if (!user?.id) return { ok: false, message: "وارد شوید." };
  if (!z.uuid().safeParse(accountId).success) return { ok: false, message: "درخواست معتبر نیست." };
  try {
    const { realizedChange } = await syncTradingAccount(user.id, accountId);
    refresh();
    return { ok: true, message: resultMessage(realizedChange) };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "به‌روزرسانی خودکار انجام نشد." };
  }
}

export async function linkTradingAccountAction(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const user = await signedIn();
  if (!user?.id) return { ok: false, message: "وارد شوید." };
  const accountId = String(fd.get("accountId") ?? "");
  if (!z.uuid().safeParse(accountId).success) return { ok: false, message: "حساب را انتخاب کنید." };
  try {
    await linkTradingAccount(user.id, accountId, String(fd.get("address") ?? ""));
    const { realizedChange } = await syncTradingAccount(user.id, accountId);
    refresh();
    return { ok: true, message: `آدرس ثبت شد. ${resultMessage(realizedChange)}` };
  } catch (e) {
    refresh();
    return { ok: false, message: e instanceof Error ? e.message : "ثبت آدرس انجام نشد." };
  }
}

export async function unlinkTradingAccountAction(accountId: string): Promise<ActionResult> {
  const user = await signedIn();
  if (!user?.id) return { ok: false, message: "وارد شوید." };
  if (!z.uuid().safeParse(accountId).success) return { ok: false, message: "درخواست معتبر نیست." };
  await unlinkTradingAccount(user.id, accountId);
  refresh();
  return { ok: true, message: "آدرس حذف شد؛ از این به بعد عددها را دستی وارد کنید." };
}
