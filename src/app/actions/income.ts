"use server";

/**
 * Recurring income reminders. (Occupations are chosen in the setup wizard.)
 *
 * Recording a reminder goes through `createTransactionAction` — the same
 * validation, ledger write, FX freeze and tenant checks as the form — with the
 * reminder's own category, account and amount.
 */
import { revalidatePath } from "next/cache";
import { createTransactionAction, type ActionResult } from "@/app/actions";
import { getCurrentUser } from "@/lib/auth";
import { getLatestUsdIrtRateForUser } from "@/lib/fx";
import { todayIso } from "@/lib/format";
import { D } from "@/domain/decimal";
import { closeIncomeOccurrence, getIncomePlan, stopIncomePlan } from "@/features/income/service";

const LOGIN_REQUIRED: ActionResult = { ok: false, message: "برای ادامه ابتدا وارد شوید." };

/** Record a due recurring income with its saved amount — one tap. */
export async function recordPlannedIncomeAction(planId: string): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!user) return LOGIN_REQUIRED;
  const plan = await getIncomePlan(planId, user.id);
  if (!plan) return { ok: false, message: "یادآوری درآمد یافت نشد یا قبلاً ثبت شده است." };

  const today = todayIso();
  const isToman = plan.symbol === "IRT" || plan.symbol === "IRR";
  const rate = D((await getLatestUsdIrtRateForUser(user.id)).rate || "0");

  const fd = new FormData();
  fd.set("type", "income");
  fd.set("entryDate", plan.plannedDate <= today ? plan.plannedDate : today);
  fd.set("description", plan.title);
  fd.set("primaryAccountId", plan.accountId);
  fd.set("categoryId", plan.categoryId);
  fd.set("nativeAmount", plan.amountNative);
  fd.set("planId", plan.id);
  fd.set("feeMode", "irt");
  // A Toman hint for the generic amount check; the server books the native amount exactly.
  fd.set("irtAmount", isToman ? D(plan.amountNative).toFixed(0) : D(plan.amountNative).mul(rate.gt(0) ? rate : 1).toFixed(0));
  return createTransactionAction(null, fd);
}

export async function recordPlannedIncomeFormAction(formData: FormData): Promise<void> {
  await recordPlannedIncomeAction(String(formData.get("planId") ?? ""));
  revalidatePath("/");
}

/** «این ماه دریافت نشد» — nothing is posted; next month's reminder is scheduled. */
export async function skipPlannedIncomeFormAction(formData: FormData): Promise<void> {
  const user = await getCurrentUser();
  if (!user) return;
  await closeIncomeOccurrence({ planId: String(formData.get("planId") ?? ""), userId: user.id, entryId: null }).catch(() => undefined);
  revalidatePath("/");
}

/** Stop a recurring income altogether. */
export async function stopPlannedIncomeFormAction(formData: FormData): Promise<void> {
  const user = await getCurrentUser();
  if (!user) return;
  await stopIncomePlan(String(formData.get("planId") ?? ""), user.id);
  revalidatePath("/");
}
