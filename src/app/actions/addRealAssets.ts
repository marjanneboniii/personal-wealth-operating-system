"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth";
import { authUsersExistCached } from "@/lib/tenantState";
import { todayIso } from "@/lib/format";
import { D } from "@/domain/decimal";
import { createRealEstateAsset, ensureRealEstateModuleReady } from "@/features/rwa/realEstate/service";
import { createUserVehicle, ensureVehicleModuleReady } from "@/features/rwa/vehicle/service";

/**
 * «افزودن ملک / خودرو» inside «دارایی‌های واقعی» — the same search → + → card
 * flow as the setup wizard, several rows at once.
 *
 * IT BUILDS NOTHING NEW. Each row goes, unchanged, through
 * `createRealEstateAsset` / `createUserVehicle` — the same writes the full
 * forms and the setup wizard use. Rows are independent: one failing row is
 * reported and the others are still registered.
 */

export type AddRealAssetsResult = {
  ok: boolean;
  message: string;
  /** Keys of the draft rows that were registered — the client drops them. */
  addedKeys: string[];
};

export type PropertyAddRow = {
  key: string;
  cityId: string;
  neighborhoodId: string;
  propertyTypeId: string;
  acquisitionDate: string;
  purchasePriceToman: string;
  currentValueToman: string;
  sizeSqm: string;
};

export type VehicleAddRow = {
  key: string;
  catalogId: string;
  /** Already resolved on the client («همان سال خرید» → the Jalali year). */
  manufacturingYear: string;
  ownershipDate: string;
  purchasePriceToman: string;
  currentValueToman: string;
};

async function guard(): Promise<{ denied: string } | { userId: string | null }> {
  try {
    const user = await getCurrentUser();
    const hasAuth = await authUsersExistCached();
    if (hasAuth && !user) return { denied: "برای این عملیات ابتدا وارد شوید." };
    return { userId: user?.id ?? null };
  } catch {
    return { denied: "خطای احراز هویت: دسترسی رد شد" };
  }
}

function refresh() {
  for (const path of ["/asset-registry", "/", "/assets", "/portfolio", "/net-worth", "/reports", "/insights"]) {
    revalidatePath(path);
  }
}

const positive = (value: string) => {
  try {
    return D(value || "0").gt(0);
  } catch {
    return false;
  }
};

function summarize(kind: "ملک" | "خودرو", added: number, errors: string[]): AddRealAssetsResult["message"] {
  const parts: string[] = [];
  if (added > 0) parts.push(`${added.toLocaleString("fa-IR")} ${kind} ثبت شد.`);
  if (errors.length > 0) parts.push(errors.join(" "));
  return parts.join(" ") || `${kind}ی برای ثبت انتخاب نشده است.`;
}

export async function addPropertiesAction(input: {
  rows: PropertyAddRow[];
  paymentAccountId?: string | null;
}): Promise<AddRealAssetsResult> {
  const auth = await guard();
  if ("denied" in auth) return { ok: false, message: auth.denied, addedKeys: [] };

  const addedKeys: string[] = [];
  const errors: string[] = [];
  try {
    await ensureRealEstateModuleReady();
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "بخش املاک آماده نیست.", addedKeys };
  }

  const today = todayIso();
  for (const row of input.rows ?? []) {
    const hasCurrentValue = positive(row.currentValueToman);
    try {
      await createRealEstateAsset({
        userId: auth.userId,
        cityId: row.cityId,
        neighborhoodId: row.neighborhoodId,
        propertyTypeId: row.propertyTypeId,
        acquisitionDate: row.acquisitionDate,
        // No current value: the purchase price is the valuation of the purchase day.
        valuationDate: hasCurrentValue ? today : row.acquisitionDate,
        purchasePriceToman: row.purchasePriceToman,
        currentValueToman: hasCurrentValue ? row.currentValueToman : row.purchasePriceToman,
        sizeSqm: row.sizeSqm || null,
        paymentAccountId: input.paymentAccountId || null,
      });
      addedKeys.push(row.key);
    } catch (error) {
      errors.push(error instanceof Error ? error.message : "ثبت ملک ناموفق بود.");
    }
  }

  if (addedKeys.length) refresh();
  return { ok: errors.length === 0 && addedKeys.length > 0, message: summarize("ملک", addedKeys.length, errors), addedKeys };
}

export async function addVehiclesAction(input: {
  rows: VehicleAddRow[];
  paymentAccountId?: string | null;
}): Promise<AddRealAssetsResult> {
  const auth = await guard();
  if ("denied" in auth) return { ok: false, message: auth.denied, addedKeys: [] };

  const addedKeys: string[] = [];
  const errors: string[] = [];
  try {
    await ensureVehicleModuleReady();
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "بخش خودرو آماده نیست.", addedKeys };
  }

  const today = todayIso();
  for (const row of input.rows ?? []) {
    try {
      await createUserVehicle({
        userId: auth.userId,
        catalogId: row.catalogId,
        manufacturingYear: Number(row.manufacturingYear),
        ownershipDate: row.ownershipDate,
        purchasePriceToman: row.purchasePriceToman,
        paymentAccountId: input.paymentAccountId || null,
        initialValuation: positive(row.currentValueToman)
          ? { valueToman: row.currentValueToman, snapshotDate: today, note: "اولین ارزش‌گذاری ثبت‌شده" }
          : undefined,
      });
      addedKeys.push(row.key);
    } catch (error) {
      errors.push(error instanceof Error ? error.message : "ثبت خودرو ناموفق بود.");
    }
  }

  if (addedKeys.length) refresh();
  return { ok: errors.length === 0 && addedKeys.length > 0, message: summarize("خودرو", addedKeys.length, errors), addedKeys };
}
