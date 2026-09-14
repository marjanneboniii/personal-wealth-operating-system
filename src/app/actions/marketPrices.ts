"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth";
import { authUsersExistCached } from "@/lib/tenantState";
import { formatMoney } from "@/lib/format";
import { deleteMarketPrice, recordMarketPrice } from "@/features/rwa/realEstate/market/service";

export type MarketPriceResult = { ok: boolean; message: string };

/** Signed-in user (or legacy single-tenant mode). Fail-closed on auth errors. */
async function guardUser(): Promise<{ denied: string } | { userId: string | null }> {
  try {
    const user = await getCurrentUser();
    let hasAuth = false;
    try {
      hasAuth = await authUsersExistCached();
    } catch {
      return { denied: "خطای احراز هویت/پایگاه داده: دسترسی رد شد" };
    }
    if (hasAuth && !user) return { denied: "برای این عملیات ابتدا وارد شوید." };
    return { userId: user?.id ?? null };
  } catch {
    return { denied: "خطای احراز هویت: دسترسی رد شد" };
  }
}

const val = (f: FormData, key: string) => String(f.get(key) ?? "").trim();
const numeric = (f: FormData, key: string) => val(f, key).replace(/[,٬\s]/g, "");

export async function recordMarketPriceAction(_previous: MarketPriceResult | null, form: FormData): Promise<MarketPriceResult> {
  const guard = await guardUser();
  if ("denied" in guard) return { ok: false, message: guard.denied };
  try {
    const sample = numeric(form, "sampleCount");
    const price = numeric(form, "pricePerSqmToman");
    const result = await recordMarketPrice({
      userId: guard.userId,
      cityId: val(form, "cityId"),
      neighborhoodId: val(form, "neighborhoodId"),
      propertyTypeId: val(form, "propertyTypeId"),
      areaBand: val(form, "areaBand") || "all",
      observedOn: val(form, "observedOn"),
      pricePerSqmToman: price,
      lowPpsqmToman: numeric(form, "lowPpsqmToman") || null,
      highPpsqmToman: numeric(form, "highPpsqmToman") || null,
      sampleCount: sample ? Number(sample) : null,
      note: val(form, "note") || null,
    });
    revalidatePath("/asset-registry");
    return {
      ok: true,
      message: `قیمت هر متر ${formatMoney(price, "IRT")} ثبت شد (≈ ${formatMoney(result.pricePerSqmUsd, "USD")} با نرخ دلار ${formatMoney(result.usdRate, "IRT")}).`,
    };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "ثبت قیمت بازار ناموفق بود." };
  }
}

export async function deleteMarketPriceAction(id: string): Promise<MarketPriceResult> {
  const guard = await guardUser();
  if ("denied" in guard) return { ok: false, message: guard.denied };
  try {
    await deleteMarketPrice(id, guard.userId);
    revalidatePath("/asset-registry");
    return { ok: true, message: "ثبت قیمت حذف شد." };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "حذف ناموفق بود." };
  }
}
