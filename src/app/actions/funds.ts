"use server";

/**
 * Server actions for registering funds and exchange-listed shares.
 *
 * SECURITY — fail-closed and login-gated, like every other write action. An
 * anonymous caller registers nothing.
 *
 * These create an asset IDENTITY. They post no journal entry and open no
 * position, so nothing here can move a balance or fabricate a FIFO lot.
 */
import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth";
import { registerInstrument, type InstrumentKind } from "@/features/funds/service";
import { searchFunds } from "@/features/funds/search";

export type RegisterInstrumentResult = {
  ok: boolean;
  message?: string;
  assetId?: string;
  created?: boolean;
};

export async function searchFundsAction(query: string, kind?: string) {
  const user = await getCurrentUser();
  if (!user) return [];
  const validKind =
    kind === "gold" || kind === "fixed_income" || kind === "etf" ? kind : undefined;
  return searchFunds(query, { kind: validKind });
}

export async function registerInstrumentAction(
  kind: string,
  symbol: string,
  name?: string,
): Promise<RegisterInstrumentResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, message: "برای ثبت باید وارد شوید." };
  if (kind !== "fund" && kind !== "stock") {
    return { ok: false, message: "نوع دارایی نامعتبر است." };
  }
  const trimmed = (symbol ?? "").trim();
  if (!trimmed) return { ok: false, message: "نماد را وارد کنید." };
  if (trimmed.length > 40) return { ok: false, message: "نماد بیش از حد طولانی است." };

  try {
    const result = await registerInstrument({
      kind: kind as InstrumentKind,
      symbol: trimmed,
      name,
    });
    revalidatePath("/assets/financial");
    revalidatePath("/onboarding");
    return { ok: true, assetId: result.assetId, created: result.created };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : "ثبت ناموفق بود.",
    };
  }
}
