"use client";

import { useActionState, useState } from "react";
import { saveOccupationsAction } from "@/app/actions/income";
import { OCCUPATIONS } from "@/features/income/occupations";
import { FormStatus } from "@/components/ui/FormStatus";

/** وضعیت شغلی — one or more; only orders the income sources offered first. */
export default function OccupationSettings({ initial }: { initial: string[] }) {
  const [selected, setSelected] = useState<string[]>(initial);
  const [state, action, pending] = useActionState(saveOccupationsAction, null);

  return (
    <form action={action} className="card space-y-3 p-4">
      <p className="muted text-[length:var(--fs-xs)] leading-5">
        یک یا چند مورد را انتخاب کنید. منابع درآمد مرتبط در فرم درآمد زودتر نمایش داده می‌شوند؛ همهٔ منابع همیشه در دسترس‌اند.
      </p>
      <div className="flex flex-wrap gap-2" role="group" aria-label="وضعیت شغلی">
        {OCCUPATIONS.map((occupation) => {
          const on = selected.includes(occupation.code);
          return (
            <label
              key={occupation.code}
              className="chip cursor-pointer"
              style={on ? { borderColor: "var(--action)", background: "var(--action-soft)", color: "var(--action)" } : undefined}
            >
              <input
                type="checkbox"
                name="occupations"
                value={occupation.code}
                checked={on}
                onChange={() =>
                  setSelected((current) => (on ? current.filter((code) => code !== occupation.code) : [...current, occupation.code]))
                }
                className="sr-only"
              />
              {occupation.label}
            </label>
          );
        })}
      </div>
      <button className="btn btn-primary" disabled={pending}>
        {pending ? "در حال ذخیره…" : "ذخیره"}
      </button>
      <FormStatus state={state} />
    </form>
  );
}
