"use server";

/**
 * Registering existing debts during initial setup.
 *
 * A user arriving with three loans, a car instalment plan and a family debt
 * has to be able to enter ALL of them — the wizard previously had no place for
 * any of them, so every new account started with assets only and a net worth
 * that was simply wrong until the user found the debts module on their own.
 *
 * ATOMIC ON PURPOSE. Every row is validated first, then all are inserted in
 * one transaction: registering four loans and failing on the fourth must not
 * leave three behind for the user to reconcile by hand.
 *
 * PLANNING ONLY — see createDebt.ts. Nothing here posts a journal entry.
 */
import { db } from "@/db";
import { getCurrentUser } from "@/lib/auth";
import { getLatestUsdIrtRate, getLatestUsdIrtRateForUser } from "@/lib/fx";
import {
  createDebtRecord,
  validateDebtInput,
  type CreateDebtInput,
} from "@/features/planning/createDebt";
import { recordAuditEvent } from "@/lib/audit";

export type SetupDebtDraft = {
  title: string;
  creditor: string;
  principalIrt: string;
  interestRate?: string;
  startDate: string;
  installmentCount?: number;
  installmentIrt?: string;
  firstDueDate?: string;
};

export type SetupDebtsResult = {
  ok: boolean;
  message?: string;
  created?: number;
  /** Index of the row that failed, so the form can point at it. */
  failedIndex?: number;
};

/** Hard ceiling — a setup form is not a bulk import tool. */
const MAX_DEBTS = 20;

export async function registerSetupDebtsAction(
  drafts: SetupDebtDraft[],
): Promise<SetupDebtsResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, message: "برای ثبت بدهی‌ها ابتدا وارد شوید." };

  if (!Array.isArray(drafts) || drafts.length === 0) {
    return { ok: true, created: 0 };
  }
  if (drafts.length > MAX_DEBTS) {
    return { ok: false, message: `حداکثر ${MAX_DEBTS} بدهی در راه‌اندازی اولیه قابل ثبت است.` };
  }

  const inputs: CreateDebtInput[] = drafts.map((draft) => ({
    userId: user.id,
    title: draft.title ?? "",
    creditor: draft.creditor ?? "",
    principalIrt: draft.principalIrt ?? "",
    interestRate: draft.interestRate ?? "0",
    startDate: draft.startDate ?? "",
    installmentCount: Number(draft.installmentCount ?? 0),
    installmentIrt: draft.installmentIrt ?? "",
    firstDueDate: draft.firstDueDate ?? "",
  }));

  // Validate EVERY row before writing any of them.
  for (let i = 0; i < inputs.length; i++) {
    const invalid = validateDebtInput(inputs[i]);
    if (invalid) return { ok: false, message: invalid, failedIndex: i };
  }

  const fx = user ? await getLatestUsdIrtRateForUser(user.id) : await getLatestUsdIrtRate();

  try {
    const ids = await db.transaction(async (tx) => {
      const out: string[] = [];
      for (const input of inputs) {
        out.push(
          await createDebtRecord(input, {
            usdIrtRate: fx.rate,
            tx: tx as unknown as typeof db,
          }),
        );
      }
      return out;
    });

    await recordAuditEvent({
      action: "CREATE_DEBT",
      entityType: "debt",
      entityId: ids[0] ?? null,
      userId: user.id,
      result: "SUCCESS",
      payload: {
        source: "setup_wizard",
        count: ids.length,
        rateSource: fx.source,
        rateDate: fx.effectiveDate,
        ledgerMutation: false,
      },
    });

    return { ok: true, created: ids.length };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : "ثبت بدهی‌ها ناموفق بود.",
    };
  }
}
