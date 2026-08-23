"use client";

import { useActionState, useState } from "react";
import type { RealEstateResult } from "@/app/actions/realEstate";
import {
  createCityAction,
  createNeighborhoodAction,
  createPropertyTypeAction,
  setCityActiveAction,
  setNeighborhoodActiveAction,
  setPropertyTypeActiveAction,
  updateCityAction,
  updateNeighborhoodAction,
  updatePropertyTypeAction,
} from "@/app/actions/realEstate";
import type { City, Neighborhood, PropertyType } from "@/features/rwa/realEstate/types";
import { Labeled, Result, faNum } from "./shared";

type MasterAction = (previous: RealEstateResult | null, form: FormData) => Promise<RealEstateResult>;

function AddForm({
  action,
  title,
  fields,
  hiddenFields,
}: {
  action: MasterAction;
  title: string;
  fields: { name: string; label: string; placeholder?: string; dir?: "ltr" | "rtl"; required?: boolean }[];
  hiddenFields?: { name: string; value: string }[];
}) {
  const [state, formAction, pending] = useActionState(action, null);
  return (
    <form action={formAction} className="space-y-3 rounded-[var(--r-md)] p-3" style={{ background: "var(--sunken)" }}>
      <h5 className="text-[12px] font-semibold">{title}</h5>
      {hiddenFields?.map((h) => (
        <input key={h.name} type="hidden" name={h.name} value={h.value} />
      ))}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {fields.map((f) => (
          <Labeled key={f.name} label={f.label} required={f.required}>
            <input className="field" name={f.name} dir={f.dir} placeholder={f.placeholder} required={f.required} />
          </Labeled>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button className="btn btn-primary !py-1.5 text-[11.5px]" disabled={pending}>
          {pending ? "…" : "افزودن"}
        </button>
        {state && <span className="text-[10.5px]">{state.message}</span>}
      </div>
    </form>
  );
}

function ToggleForm({ action, id, isActive }: { action: MasterAction; id: string; isActive: boolean }) {
  const [state, formAction, pending] = useActionState(action, null);
  return (
    <form action={formAction} className="inline-flex items-center gap-1.5">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="isActive" value={isActive ? "on" : "off"} />
      <button
        className="rounded-full px-2 py-0.5 text-[10px] font-medium"
        style={{
          background: isActive ? "var(--positive-soft)" : "var(--sunken)",
          color: isActive ? "var(--positive)" : "var(--text-2)",
        }}
        disabled={pending}
        title={isActive ? "کلیک: غیرفعال کردن" : "کلیک: فعال کردن"}
      >
        {isActive ? "فعال" : "غیرفعال"}
      </button>
      {state && <span className="muted text-[9.5px]">{state.message}</span>}
    </form>
  );
}

function RenameForm({ action, id, initial, withEn = true }: { action: MasterAction; id: string; initial: string; withEn?: boolean }) {
  const [state, formAction, pending] = useActionState(action, null);
  const [editing, setEditing] = useState(false);
  if (!editing) {
    return (
      <button className="muted text-[10px] underline" onClick={() => setEditing(true)}>
        اصلاح نام
      </button>
    );
  }
  return (
    <form action={formAction} className="flex flex-wrap items-center gap-1.5">
      <input type="hidden" name="id" value={id} />
      <input name="nameFa" defaultValue={initial} className="field !w-32 !py-1 text-[10.5px]" required />
      {withEn && <input name="nameEn" defaultValue={initial} className="field !w-24 !py-1 text-[10.5px]" dir="ltr" />}
      <button className="btn btn-primary !px-2 !py-1 text-[10px]" disabled={pending}>
        ذخیره
      </button>
      <button type="button" className="btn !px-2 !py-1 text-[10px]" onClick={() => setEditing(false)}>
        بستن
      </button>
      {state && <span className="muted text-[9.5px]">{state.message}</span>}
    </form>
  );
}

function Code({ children }: { children: string }) {
  return (
    <span className="font-mono text-[10px]" dir="ltr">
      {children}
    </span>
  );
}

/**
 * مدیریت Master Data املاک — فقط مدیر:
 * شهر جدید · غیرفعال‌سازی · اصلاح نام؛ محله برای هر شهر؛ نوع ملک جدید.
 * همه‌چیز Dynamic است و بدون تغییر Schema انجام می‌شود.
 */
export default function MasterDataAdmin({
  cities,
  neighborhoods,
  propertyTypes,
}: {
  cities: City[];
  neighborhoods: Neighborhood[];
  propertyTypes: PropertyType[];
}) {
  const [adminCityId, setAdminCityId] = useState(cities[0]?.id ?? "");
  const cityNeighborhoods = neighborhoods.filter((n) => n.cityId === adminCityId);

  return (
    <div className="space-y-6">
      {/* ── Cities ── */}
      <div className="space-y-3">
        <h4 className="text-[13px] font-semibold">شهرها ({faNum(cities.length)})</h4>
        <AddForm
          action={createCityAction}
          title="افزودن شهر جدید"
          fields={[
            { name: "nameFa", label: "نام فارسی", required: true },
            { name: "nameEn", label: "نام انگلیسی", dir: "ltr", required: true },
            { name: "code", label: "کد داخلی", dir: "ltr", required: true, placeholder: "AHZ" },
          ]}
        />
        <div className="space-y-1.5">
          {cities.map((c) => (
            <div key={c.id} className="soft flex flex-wrap items-center gap-3 rounded-[var(--r-md)] px-3 py-2 text-[11.5px]">
              <b>{c.nameFa}</b>
              <span className="muted" dir="ltr">
                {c.nameEn}
              </span>
              <Code>{c.code}</Code>
              <span className="mr-auto flex flex-wrap items-center gap-3">
                <ToggleForm action={setCityActiveAction} id={c.id} isActive={c.isActive} />
                <RenameForm action={updateCityAction} id={c.id} initial={c.nameFa} />
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* ── Neighborhoods per city ── */}
      <div className="space-y-3">
        <h4 className="text-[13px] font-semibold">مناطق / محله‌ها — وابسته به شهر</h4>
        <div className="flex flex-wrap items-end gap-3">
          <Labeled label="شهر">
            <select className="field" value={adminCityId} onChange={(e) => setAdminCityId(e.target.value)}>
              {cities.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nameFa} ({c.code})
                </option>
              ))}
            </select>
          </Labeled>
          <span className="muted pb-2 text-[10.5px]">
            {faNum(cityNeighborhoods.length)} محله برای این شهر تعریف شده است.
          </span>
        </div>
        <AddForm
          action={createNeighborhoodAction}
          title="افزودن محله به این شهر"
          hiddenFields={[{ name: "cityId", value: adminCityId }]}
          fields={[
            { name: "nameFa", label: "نام فارسی", required: true },
            { name: "nameEn", label: "نام انگلیسی", dir: "ltr", required: true },
            { name: "code", label: "کد داخلی", dir: "ltr", required: true, placeholder: "KPE" },
          ]}
        />
        <div className="grid gap-1.5 sm:grid-cols-2">
          {cityNeighborhoods.map((n) => (
            <div key={n.id} className="soft flex flex-wrap items-center gap-3 rounded-[var(--r-md)] px-3 py-2 text-[11.5px]">
              <b>{n.nameFa}</b>
              <span className="muted" dir="ltr">
                {n.nameEn}
              </span>
              <Code>{n.code}</Code>
              <span className="mr-auto flex flex-wrap items-center gap-3">
                <ToggleForm action={setNeighborhoodActiveAction} id={n.id} isActive={n.isActive} />
                <RenameForm action={updateNeighborhoodAction} id={n.id} initial={n.nameFa} />
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* ── Property types ── */}
      <div className="space-y-3">
        <h4 className="text-[13px] font-semibold">انواع ملک ({faNum(propertyTypes.length)})</h4>
        <AddForm
          action={createPropertyTypeAction}
          title="افزودن نوع ملک جدید"
          fields={[
            { name: "nameFa", label: "نام فارسی", required: true },
            { name: "nameEn", label: "نام انگلیسی", dir: "ltr", required: true },
            { name: "code", label: "کد داخلی", dir: "ltr", required: true, placeholder: "APT" },
          ]}
        />
        <div className="grid gap-1.5 sm:grid-cols-2">
          {propertyTypes.map((p) => (
            <div key={p.id} className="soft flex flex-wrap items-center gap-3 rounded-[var(--r-md)] px-3 py-2 text-[11.5px]">
              <b>{p.nameFa}</b>
              <span className="muted" dir="ltr">
                {p.nameEn}
              </span>
              <Code>{p.code}</Code>
              <span className="mr-auto flex flex-wrap items-center gap-3">
                <ToggleForm action={setPropertyTypeActiveAction} id={p.id} isActive={p.isActive} />
                <RenameForm action={updatePropertyTypeAction} id={p.id} initial={p.nameFa} />
              </span>
            </div>
          ))}
        </div>
      </div>

      <div className="muted text-[10.5px] leading-5">
        این کدها شناسه‌های داخلی دادهٔ پایه‌اند و برای جست‌وجو و یکپارچگی شهر، محله و نوع ملک استفاده می‌شوند. شناسهٔ
        دارایی مستقل و به‌شکل عددی کوتاه (مانند <Code>001</Code>) توسط سیستم تولید می‌شود.
      </div>
    </div>
  );
}
