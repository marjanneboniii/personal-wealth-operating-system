"use client";

export default function PdfButton({ targetId = "monthly-report" }: { targetId?: string }) {
  const handlePrint = () => {
    const el = document.getElementById(targetId);
    if (!el) {
      window.print();
      return;
    }
    const w = window.open("", "_blank");
    if (!w) {
      window.print();
      return;
    }
    const html = el.innerHTML;
    w.document.write(`
      <html dir="rtl" lang="fa">
        <head>
          <meta charset="utf-8" />
          <title>گزارش ماهانه — PWOS</title>
          <style>
            @font-face { font-family: Vazirmatn; src: url(/fonts/Vazirmatn-Regular.woff2) format("woff2"); font-weight: 400; }
            :root { --ink-800: #1a2b3b; --ink-500: #687887; --paper-200: #e1e5e9; --paper-100: #edf0f2; }
            body { font-family: Vazirmatn, sans-serif; padding: 24px; color: var(--ink-800); }
            .muted { color: var(--ink-500); font-size: 12px; }
            .num { font-family: "JetBrains Mono", ui-monospace, monospace; font-variant-numeric: tabular-nums; }
            table { width: 100%; border-collapse: collapse; font-size: 12px; }
            th, td { border: 1px solid var(--paper-200); padding: 6px 8px; text-align: right; }
            th { background: var(--paper-100); }
            h1 { font-size: 18px; margin-bottom: 4px; }
            h2 { font-size: 14px; margin: 16px 0 8px; }
            .header { text-align: center; border-bottom: 2px solid var(--ink-800); padding-bottom: 12px; margin-bottom: 16px; }
            @media print { button { display:none } }
          </style>
        </head>
        <body>
          <div class="header">
            <h1>گزارش ماهانه — توازن</h1>
            <div class="muted">تولید شده از روی تراکنش‌های ثبت‌شده موجود — هیچ جدول Summary موازی استفاده نشده</div>
            <div class="muted">تاریخ چاپ: ${new Date().toLocaleDateString("fa-IR")} / ${new Date().toISOString().slice(0,10)}</div>
          </div>
          ${html}
          <div class="muted" style="margin-top:24px; text-align:center;">این گزارش بر اساس ماه‌های شمسی سازمان‌دهی شده و شامل مبلغ به تومان، معادل به دلار، تفکیک دسته‌بندی و نمودار روند است.</div>
        </body>
      </html>
    `);
    w.document.close();
    w.focus();
    setTimeout(() => w.print(), 300);
  };

  return (
    <button onClick={handlePrint} className="btn btn-primary !py-1.5 !px-3 text-xs">
      خروجی PDF
    </button>
  );
}
