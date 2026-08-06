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
            body { font-family: system-ui, -apple-system, sans-serif; padding: 24px; color: #111; }
            .muted { color: #666; font-size: 11px; }
            .num { font-family: ui-monospace, monospace; }
            table { width: 100%; border-collapse: collapse; font-size: 12px; }
            th, td { border: 1px solid #ddd; padding: 6px 8px; text-align: right; }
            th { background: #f5f5f5; }
            h1 { font-size: 18px; margin-bottom: 4px; }
            h2 { font-size: 14px; margin: 16px 0 8px; }
            .header { text-align: center; border-bottom: 2px solid #111; padding-bottom: 12px; margin-bottom: 16px; }
            @media print { button { display:none } }
          </style>
        </head>
        <body>
          <div class="header">
            <h1>گزارش ماهانه — سیستم‌عامل ثروت شخصی (PWOS)</h1>
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
