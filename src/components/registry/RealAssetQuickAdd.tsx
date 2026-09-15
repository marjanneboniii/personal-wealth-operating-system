"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  SetupPropertiesStep,
  SetupVehiclesStep,
  propertyRowReady,
  vehicleRowReady,
  vehicleYearOf,
  type PropertyDraftRow,
  type VehicleDraftRow,
} from "@/components/setup/SetupRealAssetsStep";
import { addPropertiesAction, addVehiclesAction, type AddRealAssetsResult } from "@/app/actions/addRealAssets";
import { faCount } from "@/lib/format";
import { Result } from "@/components/registry/vehicle/shared";

/**
 * «افزودن ملک / خودرو» — the setup wizard's search → + → card flow, reused as
 * is inside «دارایی‌های واقعی». Several rows can be drafted and registered in
 * one go; nothing is written until «ثبت» is pressed.
 */
export default function RealAssetQuickAdd({
  kind,
  bankAccounts = [],
}: {
  kind: "property" | "vehicle";
  /** Toman bank accounts a purchase made now may be paid from. */
  bankAccounts?: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [propertyRows, setPropertyRows] = useState<PropertyDraftRow[]>([]);
  const [vehicleRows, setVehicleRows] = useState<VehicleDraftRow[]>([]);
  const [paymentAccountId, setPaymentAccountId] = useState("");
  const [result, setResult] = useState<AddRealAssetsResult | null>(null);
  const [pending, startTransition] = useTransition();

  const noun = kind === "property" ? "ملک" : "خودرو";
  const rowCount = kind === "property" ? propertyRows.length : vehicleRows.length;
  const readyCount =
    kind === "property" ? propertyRows.filter(propertyRowReady).length : vehicleRows.filter(vehicleRowReady).length;

  const submit = () => {
    setResult(null);
    startTransition(async () => {
      const response =
        kind === "property"
          ? await addPropertiesAction({
              paymentAccountId: paymentAccountId || null,
              rows: propertyRows.filter(propertyRowReady).map((row) => ({
                key: row.key,
                cityId: row.cityId,
                neighborhoodId: row.neighborhoodId,
                propertyTypeId: row.propertyTypeId,
                acquisitionDate: row.acquisitionDate,
                purchasePriceToman: row.purchasePriceToman,
                currentValueToman: row.currentValueToman,
                sizeSqm: row.sizeSqm,
              })),
            })
          : await addVehiclesAction({
              paymentAccountId: paymentAccountId || null,
              rows: vehicleRows.filter(vehicleRowReady).map((row) => ({
                key: row.key,
                catalogId: row.catalogId,
                manufacturingYear: vehicleYearOf(row),
                ownershipDate: row.ownershipDate,
                purchasePriceToman: row.purchasePriceToman,
                currentValueToman: row.currentValueToman,
              })),
            });
      setResult(response);
      if (response.addedKeys.length) {
        const added = new Set(response.addedKeys);
        setPropertyRows((rows) => rows.filter((row) => !added.has(row.key)));
        setVehicleRows((rows) => rows.filter((row) => !added.has(row.key)));
        router.refresh();
      }
    });
  };

  return (
    <div className="re-quick">
      {kind === "property" ? (
        <SetupPropertiesStep rows={propertyRows} onChange={setPropertyRows} showIntro={false} />
      ) : (
        <SetupVehiclesStep rows={vehicleRows} onChange={setVehicleRows} showIntro={false} />
      )}

      {rowCount > 0 && (
        <div className="re-quick-foot">
          {bankAccounts.length > 0 && (
            <div className="min-w-0">
              <label className="label" htmlFor={`re-quick-pay-${kind}`}>
                پرداخت از
              </label>
              <select
                id={`re-quick-pay-${kind}`}
                className="field"
                value={paymentAccountId}
                onChange={(event) => setPaymentAccountId(event.target.value)}
              >
                <option value="">بدون پرداخت — تملک قبلی</option>
                {bankAccounts.map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.name}
                  </option>
                ))}
              </select>
            </div>
          )}
          <button type="button" className="btn btn-primary" disabled={pending || readyCount === 0} onClick={submit}>
            {pending ? "در حال ثبت…" : readyCount > 0 ? `ثبت ${faCount(readyCount)} ${noun}` : `ثبت ${noun}`}
          </button>
        </div>
      )}

      <Result state={result} />
    </div>
  );
}
