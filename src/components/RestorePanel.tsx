"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function RestorePanel() {
  const [status, setStatus] = useState<{ ok: boolean; msg: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  return (
    <div className="soft rounded-2xl p-3">
      <label className="label">بازیابی از فایل پشتیبان</label>
      <input
        type="file"
        accept="application/json"
        disabled={busy}
        className="field !py-2 text-[11px]"
        onChange={async (e) => {
          const file = e.target.files?.[0];
          if (!file) return;
          if (!window.confirm("بازیابی، داده‌های فعلی را جایگزین می‌کند. ادامه می‌دهید؟")) return;
          setBusy(true);
          setStatus(null);
          try {
            const json = JSON.parse(await file.text());
            const res = await fetch("/api/restore", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify(json),
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
      {busy && <p className="muted mt-2 text-[11px]">در حال بازیابی…</p>}
      {status && (
        <p className="mt-2 text-[11px]" style={{ color: status.ok ? "var(--accent)" : "var(--danger)" }}>
          {status.msg}
        </p>
      )}
    </div>
  );
}
