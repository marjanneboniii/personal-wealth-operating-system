"use client";
import { useActionState, useState } from "react";
import { saveCommodityAction, updateCommodityItemAction, updateCommodityPriceAction, type RegistryResult } from "@/app/actions/registry";
import { PreviewCard } from "@/components/ui/SmartPreview";
import AmountInput from "@/components/ui/AmountInput";
import { formatMoney } from "@/lib/format";
import VehicleModule from "@/components/registry/vehicle/VehicleModule";
import RealEstateModule from "@/components/registry/realestate/RealEstateModule";
const today = new Date().toISOString().slice(0, 10);
function Result({ state }: { state: RegistryResult | null }) {
  return state ? (
    <p className="text-xs rounded-[var(--r-md)] p-3" style={{ background: state.ok ? "var(--brand-soft)" : "var(--negative-soft)", color: state.ok ? "var(--brand)" : "var(--negative)" }}>
      {state.message}
    </p>
  ) : null;
}
function CommodityForm({ categories, items }: { categories: any[]; items: any[] }) {
  const [existing, setExisting] = useState("");
  const [preview, setPreview] = useState(false);
  const [state, action, pending] = useActionState(saveCommodityAction, null);
  return (
    <form action={action} className="space-y-4">
      <div className="grid gap-3 md:grid-cols-3">
        <div>
          <label className="label">قلم موجود</label>
          <select className="field" name="commodityId" value={existing} onChange={(e) => setExisting(e.target.value)}>
            <option value="">+ ثبت قلم جدید</option>
            {items.map((x) => (
              <option key={x.id} value={x.id}>
                {x.name} {x.category ? `— ${x.category}` : ""}
              </option>
            ))}
          </select>
        </div>
        {!existing && (
          <>
            <Field n="itemName" l="نام قلم" p="مثلاً برنج ایرانی" />
            <div>
              <label className="label">دسته موجود</label>
              <select name="categoryId" className="field">
                <option value="">بدون دسته</option>
                {categories.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.name}
                  </option>
                ))}
              </select>
            </div>
            <Field n="newCategory" l="یا دسته جدید" p="مثلاً مواد غذایی" />
          </>
        )}
        <Field n="unit" l="واحد" d="عدد" />
        <Field n="unitPrice" l="قیمت هر واحد (تومان)" type="number" unit="toman" />
        <Field n="quantity" l="تعداد / وزن" type="number" d="1" />
        <Field n="purchasedAt" l="تاریخ خرید" type="date" d={today} />
        <Field n="merchant" l="فروشگاه / فروشنده" />
        <div className="md:col-span-2">
          <label className="label">یادداشت</label>
          <input name="notes" className="field" placeholder="برند، کیفیت یا توضیحات" />
        </div>
      </div>
      <div className="flex gap-2">
        <button type="button" className="btn" onClick={() => setPreview(!preview)}>
          پیش‌نمایش
        </button>
        <button className="btn btn-primary" disabled={pending}>
          {pending ? "در حال ثبت…" : "تأیید نهایی قیمت"}
        </button>
      </div>
      {preview && (
        <PreviewCard title="پیش‌نمایش رکورد قیمت">
          <p>مبلغ کل از قیمت واحد × تعداد محاسبه و برای تحلیل تورم شخصی نگه‌داری می‌شود.</p>
        </PreviewCard>
      )}
      <Result state={state} />
    </form>
  );
}
function Field({ n, l, type = "text", d, p, unit }: { n: string; l: string; type?: string; d?: string; p?: string; unit?: string }) {
  return (
    <div>
      <label className="label">{l}</label>
      {unit ? (
        <AmountInput
          name={n}
          type={type}
          inputMode={type === "number" ? "numeric" : undefined}
          defaultValue={d}
          placeholder={p}
          className="field"
          unit={unit}
          required={["itemName", "unitPrice"].includes(n)}
        />
      ) : (
        <input name={n} type={type} defaultValue={d} placeholder={p} className="field" required={["itemName", "unitPrice"].includes(n)} />
      )}
    </div>
  );
}
function InlineEdit({ item, price }: { item?: any; price?: any }) {
  const [mode, setMode] = useState(false);
  const [state, action, pending] = useActionState(item ? updateCommodityItemAction : updateCommodityPriceAction, null);
  if (!mode)
    return (
      <button className="text-xs" style={{ color: "var(--brand)" }} onClick={() => setMode(true)}>
        ویرایش
      </button>
    );
  return (
    <form action={action} className="flex flex-wrap gap-1 items-center">
      <input type="hidden" name="id" value={(item || price).id} />
      {item ? (
        <>
          <input name="name" defaultValue={item.name} className="field !w-28 !py-1" />
          <input name="unit" defaultValue={item.unit} className="field !w-16 !py-1" />
        </>
      ) : (
        <>
          <AmountInput name="unitPrice" defaultValue={price.unitPrice} className="field !w-24 !py-1" unit="toman" hintClassName="!mt-1 !text-[10px]" />
          <input name="quantity" defaultValue={price.quantity} className="field !w-16 !py-1" />
          <input name="merchant" defaultValue={price.merchant || ""} className="field !w-24 !py-1" />
        </>
      )}
      <button className="btn btn-primary !px-2 !py-1 text-xs" disabled={pending}>
        ذخیره
      </button>
      {state && <span className="text-[10px]">{state.message}</span>}
    </form>
  );
}
export default function RegistryWorkspace({
  properties,
  vehicles,
  ownerships,
  categories,
  items,
  prices,
  vehicleBrands = [],
  vehicleModels = [],
  vehicleDashboard = [],
  vehicleSummary,
  payoutAccounts = [],
  realEstateDashboard = [],
  realEstateSummary,
  cities = [],
  neighborhoods = [],
  propertyTypes = [],
  ownerName = "کاربر فعلی",
  fxRate = "0",
}: any) {
  return (
    <>
      <div id="real-estate" className="scroll-mt-24">
        <RealEstateModule
          dashboard={realEstateDashboard}
          summary={realEstateSummary}
          cities={cities}
          neighborhoods={neighborhoods}
          propertyTypes={propertyTypes}
          ownerName={ownerName}
          fxRate={fxRate}
        />
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <section className="card p-5">
          <h2 className="font-bold mb-1">ثبت قیمت کالا</h2>
          <p className="muted text-xs mb-5">کالا، دسته و سابقه قیمت برای سنجش تورم شخصی.</p>
          <CommodityForm categories={categories} items={items} />
        </section>
        <section className="card p-5">
          <h2 className="font-bold mb-4">اقلام و قیمت‌های اخیر</h2>
          <div className="space-y-3">
            {items.map((x: any) => (
              <div key={x.id} className="soft p-2 rounded-[var(--r-md)] flex items-center justify-between">
                <span>
                  <b>{x.name}</b>
                  <small className="muted mr-2">
                    {x.category || "بدون دسته"} · {x.unit}
                  </small>
                </span>
                <InlineEdit item={x} />
              </div>
            ))}
            {prices.slice(0, 8).map((x: any) => (
              <div key={x.id} className="border-t pt-2" style={{ borderColor: "var(--border)" }}>
                <span className="text-xs">
                  <b>{x.item}</b> · {formatMoney(x.unitPrice, "IRT")}
                </span>
                <InlineEdit price={x} />
              </div>
            ))}
          </div>
        </section>
      </div>

      <div id="vehicle" className="scroll-mt-24">
        {vehicleSummary && (
          <VehicleModule
          brands={vehicleBrands}
          models={vehicleModels}
          dashboard={vehicleDashboard}
          summary={vehicleSummary}
          ownerName={ownerName}
          payoutAccounts={payoutAccounts}
        />
        )}
      </div>
    </>
  );
}
