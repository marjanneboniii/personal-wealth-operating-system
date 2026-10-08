"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function RestorePanel() {
  const [status, setStatus] = useState<{ ok: boolean; msg: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  return (
    <div className="soft rounded-[var(--r-md)] p-3">
      <p className="label">بازیابی از فایل پشتیبان</p>
      {/* The native picker prints the browser's own words («Choose File»), often
          in English; a Persian button fronts the same, still-focusable input. */}
      <label className={`btn btn-soft w-full cursor-pointer focus-within:shadow-[var(--ring)] ${busy ? "pointer-events-none opacity-60" : ""}`}>
        انتخاب فایل پشتیبان
      <input
        type="file"
        accept="application/json"
        disabled={busy}
        className="sr-only"
        onChange={async (e) => {
          const file = e.target.files?.[0];
          if (!file) return;
          if (!window.confirm("بازیابی، داده‌های فعلی را جایگزین می‌کند. ادامه می‌دهید؟")) return;
          setBusy(true);
          setStatus(null);
          try {
            const parsed = JSON.parse(await file.text());
            const payload = {
              ...parsed,
              confirmToken: "RESTORE_DATABASE_OVERWRITE",
            };
            const res = await fetch("/api/restore", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify(payload),
            });
            const out = await res.json();
            setStatus(
              out.ok
                ? { ok: true, msg: `بازیابی کامل شد — ${out.inserted} سطر بازگردانده شد.` }
                : { ok: false, msg: out.error ?? "خطای بازیابی" },
            );
            if (out.ok) router.refresh();
          } catch (err) {
            setStatus({ ok: false, msg: err instanceof Error ? err.message : "فایل نامعتبر" });
          } finally {
            setBusy(false);
          }
        }}
      />
      </label>
      {busy && <p className="muted mt-2 text-[length:var(--fs-xs)]">در حال بازیابی…</p>}
      {status && (
        <p className="mt-2 text-[length:var(--fs-xs)]" style={{ color: status.ok ? "var(--action)" : "var(--negative)" }}>
          {status.msg}
        </p>
      )}
    </div>
  );
}
