"use server";

import { and, eq, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { accounts } from "@/db/schema";
import type { ActionResult } from "@/app/actions";
import { getSetupReadyUser } from "@/lib/authGuard";
import { normalizeNumericInput } from "@/lib/numericInput";
import { authUsersExistCached } from "@/lib/tenantState";
import {
  addGoalContribution,
  cancelDebt,
  createFund,
  createUndated,
  deleteDebt,
  deleteEvent,
  deleteFund,
  deleteGoal,
  deleteUndated,
  setEventStatus,
  setGoalStatus,
  updateDebtMeta,
  updateEvent,
  updateFund,
  updateGoal,
} from "@/features/planning/planItems";

/**
 * The signed-in user's id; null only in legacy single-tenant mode (no
 * accounts registered yet), where planning rows have no owner.
 */
async function actor(): Promise<string | null> {
  const user = await getSetupReadyUser();
  if (user?.id) return user.id;
  if (await authUsersExistCached()) throw new Error("ابتدا وارد شوید.");
  return null;
}

function refresh() {
  for (const p of ["/goals", "/debts", "/debts/obligations", "/installments", "/debts/cheques", "/budgets", "/planning", "/net-worth", "/"]) revalidatePath(p);
}

async function run(fn: (userId: string | null) => Promise<void>, ok: string): Promise<ActionResult> {
  try {
    await fn(await actor());
    refresh();
    return { ok: true, message: ok };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "خطا" };
  }
}

const s = (fd: FormData, k: string) => {
  const v = fd.get(k);
  return typeof v === "string" ? v.trim() : "";
};
const money = (fd: FormData, k: string) => normalizeNumericInput(s(fd, k), { decimal: false }) || "0";

/* Goals */
export async function updateGoalAction(_p: ActionResult | null, fd: FormData) {
  return run((u) => updateGoal(u, s(fd, "id"), { name: s(fd, "name"), targetToman: money(fd, "target"), targetDate: s(fd, "date") || null }), "ذخیره شد.");
}
export async function setGoalStatusAction(id: string, status: "active" | "reached" | "archived") {
  return run((u) => setGoalStatus(u, id, status), "ذخیره شد.");
}
export async function deleteGoalAction(id: string) {
  return run((u) => deleteGoal(u, id), "حذف شد.");
}
export async function addContributionAction(_p: ActionResult | null, fd: FormData) {
  const sign = s(fd, "mode") === "out" ? "-" : "";
  return run((u) => addGoalContribution(u, s(fd, "goalId"), sign + money(fd, "amount"), s(fd, "date")), "ثبت شد.");
}

/* Funds */
export async function createFundAction(_p: ActionResult | null, fd: FormData) {
  return run(async (u) => {
    const accountId = s(fd, "accountId") || null;
    if (accountId && u) {
      const [a] = await db.select({ id: accounts.id }).from(accounts).where(and(eq(accounts.id, accountId), eq(accounts.userId, u), isNull(accounts.deletedAt))).limit(1);
      if (!a) throw new Error("حساب پیدا نشد.");
    }
    await createFund(u, { name: s(fd, "name"), kind: s(fd, "kind"), targetToman: money(fd, "target"), accountId });
  }, "صندوق ساخته شد.");
}
export async function updateFundAction(_p: ActionResult | null, fd: FormData) {
  return run((u) => updateFund(u, s(fd, "id"), { name: s(fd, "name"), targetToman: money(fd, "target") }), "ذخیره شد.");
}
export async function deleteFundAction(id: string) {
  return run((u) => deleteFund(u, id), "حذف شد.");
}

/* Events */
export async function updateEventAction(_p: ActionResult | null, fd: FormData) {
  return run((u) => updateEvent(u, s(fd, "id"), { name: s(fd, "name"), eventDate: s(fd, "date"), budgetToman: money(fd, "target") }), "ذخیره شد.");
}
export async function setEventStatusAction(id: string, status: "planned" | "done" | "cancelled") {
  return run((u) => setEventStatus(u, id, status), "ذخیره شد.");
}
export async function deleteEventAction(id: string) {
  return run((u) => deleteEvent(u, id), "حذف شد.");
}

/* Debts */
export async function updateDebtAction(_p: ActionResult | null, fd: FormData) {
  return run((u) => updateDebtMeta(u, s(fd, "id"), { title: s(fd, "name"), creditor: s(fd, "creditor") }), "ذخیره شد.");
}
export async function deleteDebtAction(id: string) {
  return run((u) => deleteDebt(u, id), "حذف شد.");
}
export async function cancelDebtAction(id: string) {
  return run((u) => cancelDebt(u, id), "لغو شد.");
}

/* Undated */
export async function createUndatedAction(_p: ActionResult | null, fd: FormData) {
  const unit = s(fd, "unit");
  const quantity = unit === "toman" ? money(fd, "quantity") : normalizeNumericInput(s(fd, "quantity"), { decimal: true }) || "0";
  const inflationPct = normalizeNumericInput(s(fd, "inflationPct"), { decimal: true }) || null;
  return run(
    (u) => createUndated(u, { direction: s(fd, "direction"), title: s(fd, "title"), unit, quantity, note: s(fd, "note"), startDate: s(fd, "startDate") || null, inflationPct }),
    "ثبت شد.",
  );
}
export async function deleteUndatedAction(id: string) {
  return run((u) => deleteUndated(u, id), "حذف شد.");
}
