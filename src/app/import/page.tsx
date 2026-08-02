"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { createImportJobAction, executeImportJobAction, type ActionResult } from "@/app/actions";
import { Card, PageHeader, Stat } from "@/components/ui/Card";
import { formatMoney } from "@/lib/format";

export default function ImportPage() {
  const [importText, setImportText] = useState("");
  const [executing, setExecuting] = useState(false);
  const [execResult, setExecResult] = useState<ActionResult | null>(null);

  const [state, formAction, pending] = useActionState<
    (ActionResult & { jobData?: any }) | null,
    FormData
  >(createImportJobAction, null);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      setImportText(String(event.target?.result || ""));
    };
    reader.readAsText(file);
  };

  const handleExecuteImport = async (jobId: string) => {
    setExecuting(true);
    setExecResult(null);
    try {
      const res = await executeImportJobAction(jobId);
      setExecResult(res);
    } catch (err) {
      setExecResult({
        ok: false,
        message: err instanceof Error ? err.message : "خطای اجرا",
      });
    } finally {
      setExecuting(false);
    }
  };

  const job = state?.jobData;

  return (
    <div className="space-y-6">
      <PageHeader
        title="درون‌ریزی تراکنش‌ها و موجودی (Import System)"
        subtitle="مهاجرت تاریخچه مالی و موجودی‌های قبلی از فایل CSV یا کلیپ‌بورد به دفترکل معتبر"
      />

      {/* Input Section */}
      <Card title="۱. بارگذاری یا چسباندن داده‌ها">
        <form action={formAction} className="space-y-4">
          <input type="hidden" name="source" value="csv" />
          <input type="hidden" name="importText" value={importText} />

          <div className="flex flex-wrap items-center gap-3">
            <label className="btn btn-primary cursor-pointer !py-2 text-xs">
              📁 انتخاب فایل CSV / TSV
              <input
                type="file"
                accept=".csv,.tsv,.txt"
                onChange={handleFileUpload}
                className="hidden"
              />
            </label>
            <span className="muted text-xs">یا متن را مستقیم در کادر زیر بچسبانید (Paste)</span>
          </div>

          <div>
            <textarea
              value={importText}
              onChange={(e) => setImportText(e.target.value)}
              placeholder={`Date, Asset, Quantity, Price, Fee, Type, Description
2025-01-10, ETH, 2, 3000, 10, buy, خرید اتریوم
2025-01-15, ETH, 1, 3500, 5, sell, فروش اتریوم
2025-02-01, GOLD18, 50, 60, 0, opening, موجودی اولیه طلا`}
              rows={8}
              className="field num w-full font-mono text-xs"
              dir="ltr"
            />
          </div>

          <div className="flex items-center justify-between">
            <p className="muted text-[11px]">
              ستون‌های معتبر: Date, Asset, Quantity, Price, Fee, Type (buy/sell/income/expense/opening)
            </p>
            <button
              type="submit"
              disabled={pending || !importText.trim()}
              className="btn btn-primary"
            >
              {pending ? "در حال اعتبارسنجی…" : "بررسی و پیش‌نمایش ←"}
            </button>
          </div>

          {state && !state.ok && (
            <p className="rounded-2xl bg-[rgba(225,29,72,0.12)] p-3 text-xs style={{ color: 'var(--danger)' }}">
              {state.message}
            </p>
          )}
        </form>
      </Card>

      {/* Preview Section */}
      {job && (
        <div className="space-y-4">
          <Card title="۲. پیش‌نمایش و اعتبارسنجی سطرها">
            <div className="grid grid-cols-3 gap-3 mb-4 sm:grid-cols-3">
              <Stat label="سطرهای شناسایی‌شده" value={String(job.rowCount)} />
              <Stat label="سطرهای معتبر" value={String(job.validCount)} tone="up" />
              <Stat label="سطرهای خطادار" value={String(job.errorCount)} tone={job.errorCount > 0 ? "down" : "neutral"} />
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-right text-xs">
                <thead className="muted">
                  <tr className="border-b" style={{ borderColor: "var(--line)" }}>
                    <th className="py-2 font-normal">سطر</th>
                    <th className="py-2 font-normal">تاریخ</th>
                    <th className="py-2 font-normal">نوع</th>
                    <th className="py-2 font-normal">دارایی</th>
                    <th className="py-2 font-normal">مقدار</th>
                    <th className="py-2 font-normal">قیمت (USD)</th>
                    <th className="py-2 font-normal">وضعیت</th>
                  </tr>
                </thead>
                <tbody>
                  {job.records.map((r: any) => (
                    <tr key={r.lineIndex} className="border-b last:border-0" style={{ borderColor: "var(--line)" }}>
                      <td className="num py-2.5 opacity-60" dir="ltr">{r.lineIndex}</td>
                      <td className="num py-2.5" dir="ltr">{r.rawData.date}</td>
                      <td className="py-2.5">
                        <span className="chip">{r.rawData.type}</span>
                      </td>
                      <td className="font-bold py-2.5">{r.rawData.asset}</td>
                      <td className="num py-2.5" dir="ltr">{r.rawData.quantity}</td>
                      <td className="num py-2.5" dir="ltr">{formatMoney(r.rawData.price)}</td>
                      <td className="py-2.5">
                        {r.status === "valid" ? (
                          <span className="chip" style={{ color: "var(--accent)" }}>
                            معتبر ✅ {r.warningMessage && `(${r.warningMessage})`}
                          </span>
                        ) : (
                          <span className="chip" style={{ color: "var(--danger)" }}>
                            خطا: {r.errorMessage}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Execution Controls */}
            <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t pt-4" style={{ borderColor: "var(--line)" }}>
              <div className="muted text-xs">
                با تایید نهایی، {job.validCount} سطر معتبر از طریق سرویس‌های حسابداری در دفترکل ثبت خواهند شد.
              </div>

              <button
                onClick={() => handleExecuteImport(job.jobId)}
                disabled={executing || job.validCount === 0}
                className="btn btn-primary !px-6"
              >
                {executing ? "در حال ثبت در دفترکل…" : "تایید و ثبت نهایی در دفترکل ←"}
              </button>
            </div>

            {execResult && (
              <div
                className="mt-4 rounded-2xl p-4 text-xs"
                style={{
                  background: execResult.ok ? "var(--accent-soft)" : "rgba(225,29,72,0.12)",
                  color: execResult.ok ? "var(--accent)" : "var(--danger)",
                }}
              >
                <div>{execResult.message}</div>
                {execResult.ok && (
                  <div className="mt-2 flex gap-3">
                    <Link href="/ledger" className="btn btn-primary !py-1 !px-3 text-[11px]">
                      مشاهده دفترکل ←
                    </Link>
                    <Link href="/portfolio" className="btn !py-1 !px-3 text-[11px]">
                      مشاهده سبد دارایی ←
                    </Link>
                  </div>
                )}
              </div>
            )}
          </Card>
        </div>
      )}
    </div>
  );
}
