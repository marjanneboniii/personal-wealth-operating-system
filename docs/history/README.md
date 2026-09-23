# بایگانی گزارش‌ها

گزارش‌های ممیزی (AUDIT)، رفع خطا (FIX)، تشخیص (DIAGNOSE) و طرح‌های اجراشده‌ی گذشته. هر کدام وضعیت سیستم را **در تاریخ خودش** توضیح می‌دهد و ممکن است بخشی از آن بعداً عوض شده باشد؛ برای رفتار فعلی به [README](../../README.md) و اسناد زنده در [`docs/`](..) مراجعه کنید. تاریخچه‌ی تغییرات در [CHANGELOG](../../CHANGELOG.md) است.

فایل‌ها با `git mv` جابه‌جا شده‌اند و تاریخچه‌ی git هر کدام حفظ است. کامنت چند migration قدیمی (مثل `drizzle/0014`) هنوز مسیر قبلی `docs/…` را ذکر می‌کند؛ migrationها عمداً ویرایش نمی‌شوند، و همان نام فایل اینجاست.

| تاریخ | گزارش | موضوع |
|---|---|---|
| 2026-08-04 | [SCENARIO_ENGINE_FINAL_REPORT](SCENARIO_ENGINE_FINAL_REPORT.md) | تحویل موتور سناریو |
| 2026-08-10 | [SECURITY_REMEDIATION_REPORT](SECURITY_REMEDIATION_REPORT.md) | رفع آسیب‌پذیری‌های احراز هویت و دسترسی |
| 2026-08-11 | [SECURITY-REMEDIATION-MULTIUSER-2026-08-11](SECURITY-REMEDIATION-MULTIUSER-2026-08-11.md) | اصلاحات امنیتی و ایزولاسیون چندکاربره |
| 2026-08-15 | [VEZAN_ARCHITECTURE_REFACTOR](VEZAN_ARCHITECTURE_REFACTOR.md) | بازآرایی معماری محصول (دوره‌ی برند «وِزان») |
| 2026-08-17 | [IMPLEMENTATION-PLAN-money-accounts](IMPLEMENTATION-PLAN-money-accounts.md) | طرح حساب‌های پول با موجودی اولیه (اجرا شد در #36) |
| 2026-08-18 | [AUDIT-PER-ACCOUNT-ACCOUNTING-CURRENCY](AUDIT-PER-ACCOUNT-ACCOUNTING-CURRENCY.md) | ممیزی ارز حسابداری هر حساب |
| 2026-08-18 | [AUDIT-PRE-IMPL-DENOMINATION-FX](AUDIT-PRE-IMPL-DENOMINATION-FX.md) | ممیزی پیش از پیاده‌سازی واحد حساب و سند FX |
| 2026-08-21 | [AUDIT-FINANCIAL-LOGIC-2026-08-21](AUDIT-FINANCIAL-LOGIC-2026-08-21.md) | ممیزی منطق مالی و حسابداری |
| 2026-08-22 | [GLOBAL-SYSTEM-DIRECTIVE-COMPLIANCE](GLOBAL-SYSTEM-DIRECTIVE-COMPLIANCE.md) | پیاده‌سازی دستورالعمل جامع سیستم |
| 2026-08-22 | [REPORT-UI-FARSI-VALUATION-2026-08](REPORT-UI-FARSI-VALUATION-2026-08.md) | فارسی‌سازی UI، تفکیک IRT/USDT/USD، ارزش‌گذاری نمای کلی |
| 2026-08-23 | [AUDIT-RWA-SHORT-SYMBOLS-2026-08-23](AUDIT-RWA-SHORT-SYMBOLS-2026-08-23.md) | شناسه‌ی کوتاه دارایی‌های واقعی |
| 2026-08-25 | [AUDIT-REAL-ASSETS-VALUATION-HISTORY-2026-08-25](AUDIT-REAL-ASSETS-VALUATION-HISTORY-2026-08-25.md) | تاریخچه‌ی ارزش‌گذاری دارایی‌های واقعی |
| 2026-08-25 | [AUDIT-REAL-ESTATE-CLEANUP-2026-08-25](AUDIT-REAL-ESTATE-CLEANUP-2026-08-25.md) | داده‌های یتیم املاک |
| 2026-09-02 | [AUDIT-TOTAL-DEBT-VS-INSTALLMENTS](AUDIT-TOTAL-DEBT-VS-INSTALLMENTS.md) | «مانده کل بدهی» در برابر «مانده اقساط» |
| 2026-09-02 | [FIX_REPORT](FIX_REPORT.md) | رفع چهار باگ در لایه‌ی کوئری، سرویس و UI |
| 2026-09-04 | [AUDIT-BUY-SELL-ACCOUNTS-ASSETS-2026-09-04](AUDIT-BUY-SELL-ACCOUNTS-ASSETS-2026-09-04.md) | ممیزی خرید و فروش، حساب‌ها و دارایی‌ها |
| 2026-09-04 | [DIAGNOSE-REAL-ESTATE-VISIBILITY-2026-09-04](DIAGNOSE-REAL-ESTATE-VISIBILITY-2026-09-04.md) | چرا «املاک من» خالی بود — قواعد نمایش |
| 2026-09-04 | [FIX-2026-09-04-asset-registry-prop-misalignment](FIX-2026-09-04-asset-registry-prop-misalignment.md) | رفع نمایش‌ندادن «املاک من» |
| 2026-09-04 | [FIX-2026-09-04-overview-debt-and-ui-labels](FIX-2026-09-04-overview-debt-and-ui-labels.md) | «کل بدهی‌ها» در نمای کلی و عناوین UI |
| 2026-09-04 | [FIX-ACCOUNTING-INTEGRITY-PNL-DEBT-2026-09-04](FIX-ACCOUNTING-INTEGRITY-PNL-DEBT-2026-09-04.md) | یکپارچگی حسابداری، سود و زیان و بدهی |
| 2026-09-04 | [FIX-CASHFLOW-TOMAN-FREEZE-2026-09-04](FIX-CASHFLOW-TOMAN-FREEZE-2026-09-04.md) | فریز مبالغ تومانی جریان نقدی و جداسازی کاربران |
| 2026-09-04 | [HOTFIX-LEDGER-TENANCY-DCA-2026-09-04](HOTFIX-LEDGER-TENANCY-DCA-2026-09-04.md) | چندکاربره‌بودن دفترکل و DCA چندارزی |
| 2026-09-07 | [AUDIT-INSTALLMENT-PAYMENT-CLASSIFICATION-2026-09-07](AUDIT-INSTALLMENT-PAYMENT-CLASSIFICATION-2026-09-07.md) | طبقه‌بندی حسابداری «پرداخت قسط» |
| 2026-09-12 | [financial-system-design-template-audit-fa.docx](financial-system-design-template-audit-fa.docx) | ممیزی قالب طراحی سیستم مالی (Word) |
