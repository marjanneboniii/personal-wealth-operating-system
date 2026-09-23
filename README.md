# توازن — سیستم‌عامل ثروت شخصی

[![Verify](https://github.com/marjanneboniii/personal-wealth-operating-system/actions/workflows/security.yml/badge.svg)](https://github.com/marjanneboniii/personal-wealth-operating-system/actions/workflows/security.yml)

مدیریت خصوصی ثروت شخصی و خانوادگی، به فارسی و با تقویم شمسی. همه‌ی پول، دارایی، بدهی و برنامه‌های آینده در یک جا، روی **حسابداری دوطرفه** و **دفترکل تغییرناپذیر**. تومان ارز اصلی نمایش است و معادل دلاری کنارش می‌آید؛ مبلغ تومانی هر سند با نرخ روز ثبت فریز می‌شود و با تغییر نرخ دلار عوض نمی‌شود.

## قابلیت‌ها

| بخش | چه کار می‌کند |
|---|---|
| **پول** | تراکنش‌ها با دسته‌بندی درختی هزینه و **هشتگ** (`#سفر`)، حساب‌ها با موجودی اولیه، جریان نقدی، دفترکل؛ درون‌ریزی **پیامک بانکی** (از جمله میان‌بر آیفون) با بازبینی پیش از ثبت |
| **دارایی‌ها** | سبد دارایی، رمزارز، سهام بورسی و صندوق، طلا، ملک و خودرو با تاریخچه‌ی ارزش‌گذاری تغییرناپذیر، ارزش خالص با تحلیل منشأ تغییر، نمای بازار |
| **تعهدات مالی** | بدهی و طلب، وام‌ها، اقساط با پرداخت بخشی، تعهدات آینده و **دفتر چک** (صادره و دریافتی، شناسه‌ی صیادی، برگشتی، پاس شدن) |
| **برنامه‌ریزی** | بودجه، اهداف و صندوق‌ها، درآمدهای ماهانه‌ی تکرارشونده، پیش‌بینی نقدینگی ماه‌به‌ماه (شمسی) |
| **بینش و یادآور** | سلامت مالی (نسبت بدهی به دارایی، **نسبت اقساط به درآمد**، نرخ پس‌انداز، دوام نقدینگی)، هشدارها، و **مرکز یادآور** با زنگوله در همه‌ی صفحه‌ها |
| **گزارش و حسابرسی** | گزارش‌های مالی، ردیاب تورم شخصی، حسابرسی زنده‌ی یکپارچگی دفترکل (`/audit`) |

رابط موبایل‌اول و راست‌به‌چپ است و به‌صورت PWA نصب می‌شود. دسکتاپ منوی کناری جمع‌شونده و مرکز فرمان `⌘K` دارد؛ موبایل نوار پایین با دکمه‌ی «+» برای ثبت سریع. فیلترها در URL می‌مانند و دکمه‌ی back مرورگر همیشه درست کار می‌کند.

## راه‌اندازی

### توسعه‌ی محلی (بدون PostgreSQL)
```bash
npm install
DATABASE_URL=memory:// APP_MODE=development npm run dev
```
با `memory://` اسکیما و داده‌ی نمونه در حافظه ساخته می‌شود. این مسیر فقط برای توسعه و تست است و در Production رد می‌شود (fail-closed).

### Production
```bash
cp .env.example .env     # مقادیر Supabase و PostgreSQL (و در صورت نیاز Redis)
npm ci
npm run db:migrate       # همیشه پیش از استقرار کد جدید
npm run build && npm start
```

> **ترتیب مهم است:** migration را **قبل** از استقرار کد جدید اجرا کنید. کدی که جدول تازه‌ای می‌خواند روی پایگاه داده‌ی migrate‌نشده خطا می‌دهد.

اگر `db:migrate` یا برنامه با خطای پایگاه داده روبه‌رو شد، پیام، علت واقعی (مثلاً نام اشتباه پایگاه داده) را نشان می‌دهد. برای بررسی کامل اتصال:
```bash
npm run db:check              # DATABASE_URL، DNS، اتصال و اسکیما
npm run db:inspect-readonly   # migrationهای اجراشده، فقط‌خواندنی
```
جزئیات استقرار و متغیرها در [`docs/SUPABASE_CUTOVER.md`](docs/SUPABASE_CUTOVER.md).

## اصول مالی

* هر سند حداقل دو ردیف دارد و `Σ base_value = 0` (در `assertBalanced`).
* **هیچ ستون موجودی وجود ندارد**؛ همه‌ی مانده‌ها با `SUM(postings)` محاسبه می‌شوند.
* اصلاح فقط با **سند معکوس**؛ سند اصلی `void` می‌شود و حذف نمی‌شود.
* خرید یک **Lot** باز می‌کند؛ فروش Lotها را به روش **FIFO** مصرف می‌کند و سود تحقق‌یافته را در حساب `4100` ثبت می‌کند. سود تحقق‌نیافته فقط گزارشی است.
* **برنامه‌ها روی دفترکل اثری ندارند** تا «اجرا» شوند: تراکنش برنامه‌ریزی‌شده، قسط، درآمد ماهانه و **چک در جریان**. اجرا در یک تراکنش پایگاه داده و idempotent است؛ ابطال سندِ پاس شدن چک، چک را دوباره «در جریان» می‌کند.
* **هزینه ≠ بازپرداخت بدهی ≠ انتقال:** بازپرداخت اصل بدهی (`debt_repayment`) و انتقال بین حساب‌ها هرگز هزینه حساب نمی‌شوند.
* **دسته و هشتگ فقط بُعد گزارش‌اند** و در تراز دوطرفه دخالتی ندارند؛ هشتگ را می‌توان بعد از ثبت هم عوض کرد.
* مبالغ تومانی قراردادی (قسط، بدهی، برنامه، چک) ثابت‌اند؛ معادل دلاری فقط نمایشی است و با نرخ روز محاسبه می‌شود.

## معماری

Next.js 16 (App Router، Server Components) · TypeScript · Supabase Auth و PostgreSQL با RLS · Drizzle ORM · Tailwind CSS v4 · zod · نمودارهای SVG بدون وابستگی · PWA · فونت Vazirmatn

```
src/domain        هسته‌ی مالی خالص: Decimal (BigInt/18)، قواعد تراز، موتور FIFO
src/features      منطق هر بخش: ledger، planning، cheques، tags، notifications، …
src/db            اسکیما (منبع حقیقت)، اتصال، seed توسعه
src/app           صفحه‌ها، Server Actionها، API
src/components    سیستم طراحی، فرم‌ها، نمودارها، پوسته‌ی موبایل‌اول
drizzle/          migrationهای SQL به ترتیب شماره
```
وابستگی یک‌طرفه است: `app → features → domain`؛ دامنه به Next یا Drizzle وابسته نیست.

## تست و CI

```bash
npm test          # همه‌ی تست‌ها (بیش از ۹۰۰ تست)
npm run typecheck
npm run lint
```
هر Pull Request از چک **Verify** می‌گذرد: typecheck، lint، `npm audit`، همه‌ی تست‌ها، build نسخه‌ی Production و gitleaks. تست‌ها در CI به ۴ بخش موازی تقسیم می‌شوند (`TEST_SHARD`)، ولی همیشه کل مجموعه اجرا می‌شود.

## پشتیبان‌گیری، امنیت و حریم خصوصی

* `GET /api/backup` خروجی JSON نسخه‌دار از همه‌ی جدول‌ها می‌دهد و `POST /api/restore` آن را به‌صورت all-or-nothing بازمی‌گرداند. توصیه‌ی عملیاتی: `pg_dump` شبانه، قاعده‌ی ۳-۲-۱ و آزمون بازیابی ماهانه.
* هویت و نشست‌ها با Supabase Auth است؛ جدول‌های مالی RLS دارند و هر کوئری در لایه‌ی سرویس هم به شناسه‌ی کاربر محدود است. کلید secret هرگز به مرورگر نمی‌رود و همه‌ی ورودی‌های مالی در سرور اعتبارسنجی می‌شوند.
* خودمیزبان و بدون تله‌متری.

## مستندات

* [`CHANGELOG.md`](CHANGELOG.md) — تاریخچه‌ی تغییرات به تفکیک ماه
* [`docs/DESIGN.md`](docs/DESIGN.md) — سند طراحی نرم‌افزار
* [`docs/UI_REDESIGN.md`](docs/UI_REDESIGN.md) و [`docs/VEZAN-DESIGN-SYSTEM.md`](docs/VEZAN-DESIGN-SYSTEM.md) — سیستم طراحی «Calm Ledger»
* [`docs/EXPENSE_CATEGORIES.md`](docs/EXPENSE_CATEGORIES.md) — دسته‌بندی هزینه‌ها
* [`docs/REAL_ESTATE.md`](docs/REAL_ESTATE.md) — قواعد ماژول املاک
* [`docs/DESIGN-ACCOUNT-DENOMINATION-AND-FX.md`](docs/DESIGN-ACCOUNT-DENOMINATION-AND-FX.md) — واحد حساب و اسناد ارزی
* [`docs/BANK-IMPORT-REVIEW.md`](docs/BANK-IMPORT-REVIEW.md) و [`docs/IPHONE-SMS-SHORTCUTS.md`](docs/IPHONE-SMS-SHORTCUTS.md) — درون‌ریزی پیامک بانکی
* [`docs/SCENARIO_ENGINE_ARCHITECTURE.md`](docs/SCENARIO_ENGINE_ARCHITECTURE.md) — موتور سناریو
* [`docs/history/`](docs/history/README.md) — بایگانی گزارش‌های ممیزی و رفع خطا
