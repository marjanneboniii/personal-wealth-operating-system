# گزارش نهایی مأموریت اصلاحات امنیتی + ایزولاسیون چندکاربره

**تاریخ:** 2026-08-11 · **شاخه:** `arena/019fefb9-personal-wealth-operating-syst` · **کامیت:** `964bbf5`

قانون شماره ۱ (عدم‌دست‌خوردگی Accounting Core) در سراسر اجرا رعایت شد؛ جزئیات در بخش ۱۹.
قانون شماره ۲ (بدون تغییر غیرمرتبط): تمام تغییرات دقیقاً در محدودهٔ ۱۰ محور مجاز مأموریت مانده‌اند.

---

## بخش ۱۸ — جدول وضعیت

| ID | شرح | وضعیت |
|----|------|--------|
| H-01 | IDOR ارزش‌گذاری ملک (بارگذاری ملک متعلق به کاربر دیگر، سپس تصمیم در application logic) | **FIXED** |
| H-02 | IDOR اسنپ‌شات ارزش‌گذاری خودروی کاربر دیگر (`userVehicleId` بدون بررسی مالکیت) | **FIXED** |
| Read Isolation | فیلتر tenant در JavaScript به‌جای SQL (املاک/خودرو/سوابق مالکیت) + نشت رکوردهای `user_id = NULL` | **FIXED** |
| M-01 | خروج `password_hash` / `pin_hash` در فایل Backup | **FIXED** |
| M-02 Ledger | حذف فیزیکی `journal_entries` (و کسکید postings) از مسیر DELETE تراکنش | **FIXED** (سند void می‌شود، حذف نمی‌شود) |
| M-02 Accounts | حذف فیزیکی حساب دارای سابقهٔ مالی | **FIXED** (آرشیو نرم؛ حذف فیزیکی فقط برای حساب بدون سابقه) |
| M-03 | پرداخت قسط غیراتمیک (سند دفتری جدا از به‌روزرسانی قسط) + race دو پرداخت هم‌زمان | **FIXED** (یک تراکنش + `FOR UPDATE`) |
| M-04 | race ابطال هم‌زمان یک سند (دو reversal موازی) | **FIXED** (قفل رکوردی + انتقال شرطی `posted→void`) |
| L-01 | فقدان هدرهای امنیتی | **FIXED** (CSP/nosniff/Referrer-Policy/Permissions-Policy همیشه؛ XFO/HSTS/frame-ancestors فقط production حفظ قابلیت پیش‌نمایش) |
| L-02 | بارگذاری فونت از CDN شخص ثالث (jsdelivr) | **FIXED** (سلف‌هاست؛ عیناً فایل‌های v33.003) |
| L-03 | کش صفحات خصوصی در Service Worker روی دستگاه مشترک | **FIXED** (SW v2: بدون کش صفحات + purge هنگام خروج/ورود) |
| Next version | نسخهٔ Next 16.2.11 با آسیب‌پذیری‌های high (nanoid / postcss / sharp-libvips) | **FIXED** (16.3.0؛ بدون شکست — ۱۹۲/۱۹۲ تست سبز) |

موارد PARTIAL / NOT-FIXED / REGRESSED: **هیچ** — باقی‌ماندهٔ پذیرفته‌شده: ۴ آسیب‌پذیری **moderate** در `esbuild` فقط در زنجیرهٔ **dev-tooling** داخلی `drizzle-kit` (بدون قرارگیری در runtime/bundle؛ رفع آن نیازمند downgrade شکنندهٔ drizzle-kit است که خارج از محدودهٔ امن مأموریت است).

---

## بخش ۱۹ — ACCOUNTING CORE PRESERVATION AUDIT

| مؤلفهٔ هستهٔ حسابداری | وضعیت | توضیح |
|---|---|---|
| General Ledger / `postEntry` (مسیر واحد ثبت، idempotency، قفل حساب‌ها) | **UNCHANGED** | بدون هیچ تغییری |
| Journal Entries (ساختار، وضعیت‌ها، insertion) | **UNCHANGED** | درج/ساختار/status semantics دست‌نخورده |
| Postings (دوطرفه، ترازی، `assertBalanced`) | **UNCHANGED** | — |
| FIFO / Lots / Cost Basis (`consumeFifo`، بازارگردانی lot در ابطال) | **UNCHANGED** | — |
| Realized PnL | **UNCHANGED** | — |
| محاسبهٔ Balance (`getAccountBalances` فیلتر `status='posted'`) | **UNCHANGED** | خالص‌سازی بعد از ابطال همچنان صفر می‌ماند |
| `reverseEntry` (منطق معکوس‌سازی، سند reversal با `status='void'`، `reversalOf`) | **UNCHANGED در منطق حسابداری** — تنها مرز تراکنش سخت شد | افزوده شد: `SELECT … FOR UPDATE` روی سند + void شرطی `posted→void` با rollback در صورت ۰ سطر. هیچ خط محاسباتی تغییر نکرد. |
| Approval / Review workflow (`entry_reviews`) | **UNCHANGED** | — |
| مرز تراکنش‌ها / Invariants / قواعد FX | **UNCHANGED** | تنها `payInstallment` که قبلاً **خارج** از هسته (لایهٔ planning) و دو-مرحله‌ای بود، یک‌تراکنشی شد؛ خودِ `postEntry` تغییری نکرد. |
| `unitsFor` | **UNCHANGED در منطق** — افزوده شد: پارامتر اختیاری `txClient` (الگوی موجود `txClient ?? db`) | بدون آن، درایورهای تک‌اتصال (PGlite) هنگام تراکنش باز deadlock می‌کردند؛ رفتار محاسباتی (آخرین قیمت، پیش‌فرض ۱) عیناً حفظ شد. |

نتیجهٔ ممیزی: **هیچ سیستم جدید delete/reversal/FIFO ساخته نشد**؛ M-02 و M-04 صرفاً از primitiveهای موجود (`reverseEntry`، تراکنش، قفل رکوردی) استفاده می‌کنند. مجموع ۷ تست FIFO/reversal موجود (`fifo-reversal.test.ts` و سایرین) همراه کل سوئیت سبز ماند.

---

## بخش ۲۰ — فهرست فایل‌ها

### ویرایش‌شده (۲۱)
| فایل | محور |
|---|---|
| `src/features/rwa/realEstate/service.ts` | H-01 + Read isolation (SQL scoping در `loadProperties`) |
| `src/features/rwa/vehicle/valuation.ts` | H-02 (راستی‌آزمایی مالکیت خودرو در سطح DB قبل از درج اسنپ‌شات) |
| `src/features/rwa/vehicle/service.ts` | `assertOwnership` سخت‌گیرانه + SQL scoping در `listVehicleAssets`/`listUserVehicles` |
| `src/features/rwa/ownership/service.ts` | SQL scoping در `listOwnershipRecords` |
| `src/app/asset-registry/page.tsx` | عبور `userId` نشست به فراخوانی‌ها |
| `src/app/api/backup/route.ts` | M-01 (whitelist ستون‌ها برای `users`) |
| `src/app/api/transactions/route.ts` | M-02 Ledger (DELETE → `reverseEntry` موجود؛ ۴۰۹ برای ابطال تکراری) |
| `src/app/api/accounts/route.ts` | M-02 Accounts (آرشیو نرم در برابر حذف مخرب) |
| `src/features/planning/service.ts` | M-03 (پرداخت قسط اتمیک + قفل رکورد + scoping) |
| `src/features/ledger/service.ts` | M-04 فقط (قفل `FOR UPDATE` + void شرطی) + پارامتر اختیاری `txClient` در `unitsFor` |
| `src/app/actions.ts` | عبور tenant به `payInstallment`؛ gate نشست در `overviewCounts` (عدم اعتماد به userId ورودی) |
| `src/db/migrate-multiuser.ts` | افزودن ۳ جدول RWA به migration مالکیت (بدون DROP/DELETE) |
| `next.config.ts` | L-01 (هدرهای امنیتی) |
| `src/app/globals.css` | L-02 (آدرس‌های فونت → `/fonts/…`) |
| `public/sw.js` | L-02/L-03 (نسخهٔ `pwos-v2`؛ حذف کش CDN و کش صفحات؛ پیام `PURGE_CACHES`) |
| `src/components/settings/UserPanel.tsx` | L-03 (purge کش هنگام خروج) |
| `src/components/auth/{LoginForm,RegisterForm,GoogleAuthButton}.tsx` | L-03 (purge دفاع‌دون‌عمق هنگام ورود) |
| `tests/final-security-remediation.test.ts` | ترمیم ۳ خطای typecheck پایه (importهای مردهٔ `.ts`-extension؛ بدون تغییر معنای تست) |
| `package.json` / `package-lock.json` / `next-env.d.ts` | Next 16.2.11→16.3.0، postcss 8.5.26، audit fix |

### افزوده‌شده (۷)
- `tests/security-isolation-hardening.test.ts` — ۸ تست جدید (۸/۸ سبز)
- `src/lib/swClient.ts` — helper پاک‌سازی کش سمت کلاینت
- `public/fonts/Vazirmatn-{Regular,Medium,SemiBold,Bold}.woff2` — فونت‌های سلف‌هاست (v33.003، OFL)
- `public/fonts/README.md` — منشأ و مجوز فونت‌ها

### حذف‌شده
هیچ‌کدام.

---

## بخش ۲۱ — راستی‌آزمایی

### گیت‌های خودکار (همه اجرا و سبز شدند)
| گیت | نتیجه |
|---|---|
| `npm run typecheck` (tsc) | ✅ بدون خطا (۳ خطای پایهٔ موجود نیز ترمیم شد) |
| `npm run lint` (eslint) | ✅ بدون خطا |
| `npm test` | ✅ **۱۹۲/۱۹۲** (۱۸۴ baseline + ۸ جدید) — هم روی 16.2.11 هم روی 16.3.0 |
| `npm run build` | ✅ موفق روی هر دو نسخه |
| `npm audit` | high: **صفر** (nanoid/postcss/sharp-libvips حذف شدند)؛ باقی: ۴ moderate dev-only (drizzle-kit/esbuild) |

### تست‌های امنیتی (§۱۴/§۱۵ — تست خودکار + smoke دستی)
| سناریو | نتیجه |
|---|---|
| ایزولاسیون خواندن چندکاربره (ملک/خودرو/مالکیت — A فقط وسایل A؛ رکوردهای NULL برای هیچ tenant نمایان نیست؛ legacy بدون نشست: سه رکورد) | ✅ `SEC — Multi-user read isolation` |
| H-01: ارزش‌گذاری ملک A با هویت B → رد با «متعلق به شما نیست»، رکورد دست‌نخورده؛ مالک → موفق | ✅ `SEC/H-01` |
| H-02: اسنپ‌شات روی خودروی A با هویت B → رد، صفر رکورد نشتی؛ مالک → موفق | ✅ `SEC/H-02` |
| M-01: Backup → `password_hash`/`pin_hash` کلیداً ABSENT و مقادیر مخفی در متن JSON نیست | ✅ `SEC/M-01` |
| M-02 Ledger: DELETE با نشست B → ۴۰۴؛ با نشست A → سند **همچنان موجود با status=void**، postings حفظ، دقیقاً ۱ سند reversal، تراز خالص صفر؛ تکرار → ۴۰۹ | ✅ `SEC/M-02 Ledger` |
| M-02 Accounts: GET/PUT/DELETE متقابل → ۴۰۴؛ حساب با سابقه → آرشیو (رکورد زنده، `isActive=false`, `deletedAt`)؛ حساب بدون سابقه → حذف فیزیکی موفق | ✅ `SEC/M-02 Accounts` |
| M-03: پرداخت B برای قسط A → رد و قسط pending؛ مالک → اتمیک (سند + paid + settle دین در یک commit)؛ replay → `alreadyPaid` بدون سند دوم؛ پیش‌شرط شکست‌خورده → **صفر سطر دفتری** (rollback کامل) | ✅ `SEC/M-03` |
| M-04: ۵ ابطال هم‌زمان → دقیقاً ۱ موفق، ۴ رد «قبلاً ابطال»، دقیقاً ۱ سند reversal | ✅ `SEC/M-04` |
| L-01 (smoke production): `X-Frame-Options: SAMEORIGIN`, HSTS, CSP کامل با `frame-ancestors 'self'`, nosniff, Referrer-Policy, Permissions-Policy روی `/offline` | ✅ مشاهده شد |
| L-01 (dev): بدون XFO/HSTS/frame-ancestors → پیش‌نمایش Arena در iframe نمی‌شکند | ✅ مشاهده شد |
| L-02: خروجی build `.next` صفر ارجاع به `cdn.jsdelivr.net`؛ فونت از `/fonts/Vazirmatn-Regular.woff2` سرو می‌شود (HTTP 200, 50,684B, `font/woff2`) | ✅ مشاهده شد |
| L-03: `sw.js` نسخهٔ `pwos-v2` با `PURGE_CACHES` و صفر ارجاع به CDN | ✅ مشاهده شد |

---

## جزئیات هر اصلاح (Before → علت → تغییر → خاصیت امنیتی → تست → نتیجه)

### H-01 — IDOR ارزش‌گذاری ملک
- **Before:** `recordRealEstateValuation` ملک را فقط با `id` بار می‌کرد و پس از load تصمیم می‌گرفت.
- **علت:** حد مرزی tenant در application logic به‌جای DB → امکان رصد/دست‌کاری ملک کاربر دیگر با حدس `propertyId`.
- **تغییر:** کوئری tenant-scoped: `WHERE id = :propertyId AND user_id = :currentUserId` (در legacy بدون هویت: سازگاری قبلی حفظ می‌شود). پیام یکسان «ملک یافت نشد یا متعلق به شما نیست.» → عدم‌افشای وجود رکورد.
- **خاصیت:** نشت صفر + منع mutation متقابل در سطح DB.
- **تست/نتیجه:** `SEC/H-01` ✅ (رد B + موفقیت A + عدم تغییر رکورد).

### H-02 — IDOR اسنپ‌شات ارزش‌گذاری خودرو
- **Before:** `recordVehicleValuationSnapshot` با `userVehicleId` دلخواه رکورد می‌ساخت.
- **تغییر:** پیش از درج، `SELECT id FROM vehicle_assets WHERE id=:vid AND user_id=:uid LIMIT 1`؛ نبود → رد.
- **تست/نتیجه:** `SEC/H-02` ✅.

### Multi-User Read Isolation (اصل قانون: NULL ≠ shared)
- **Before:** `loadProperties`/`listVehicleAssets`/`listUserVehicles` همهٔ رکوردها را خوانده و در JS فیلتر می‌کردند (و `userId === null` را به‌اشتباه «مشترک» می‌دانستند)؛ `listOwnershipRecords` نیز پس‌فیلتر JS داشت.
- **تغییر:** فیلتر به `WHERE user_id = :currentUserId` در SQL منتقل شد؛ در حالت چندکاربره رکوردهای NULL-owned خصوصی‌اند و حذف می‌شوند؛ `assertOwnership` خودرو سخت‌گیرانه شد (`row.userId !== userId` ⇒ رد)؛ در حالت legacy بدون کاربر auth (دقیقاً یک tenant) رفتار جهانی حفظ شد. `asset-registry` اکنون `userId` نشست را عبور می‌دهد؛ migration مالکیت سه جدول RWA را هم پوشش می‌دهد.
- **تست/نتیجه:** `SEC — Multi-user read isolation` ✅.

### M-01 — نشتی credential در Backup
- **Before:** `select * from users` ⇒ `password_hash`/`pin_hash` در فایل پشتیبان.
- **تغییر:** whitelist صریح ستون‌ها (`id, created_at, updated_at, deleted_at, name, role, username, email, google_id, email_verified`) با `sql.identifier` پارامتریزه؛ سایر جدول‌ها بدون تغییر. بازیابی سازگار می‌ماند (درج فقط ستون‌های موجود هر سطر).
- **تست/نتیجه:** `SEC/M-01` ✅ (ABSENT + عدم‌نشتی مقدار + حفظ ستون‌های غیرمخفی).

### M-02 Ledger — تغییرناپذیری دفترکل
- **Before:** `DELETE /api/transactions` → `db.delete(journal_entries)` (کسکید postings؛ شکست ۵۰۰ روی lotها).
- **تغییر:** استفاده از `reverseEntry` **موجود**؛ ابطال تکراری یا دارای فروش بعدی → ۴۰۹ با پیام فارسی. ممنوعیت‌های مأموریت رعایت شد: سیستم جدیدی ساخته نشد، حذف فیزیکی جریاع/سند رخ نمی‌دهد.
- **تست/نتیجه:** `SEC/M-02 Ledger` ✅ (رکورد void، postings حفظ، net-zero، ۴۰۹ تکرار).

### M-02 Accounts — حذف مخرب حساب
- **Before:** حذف فیزیکی بدون شرط.
- **تغییر:** شمارش `postings`/`lots`؛ سابقه‌دار ⇒ آرشیو نرم (`isActive=false`, `deletedAt`)؛ بدون سابقه ⇒ حذف فیزیکی، و هر خطای FK ⇒ fallback آرشیو. اثر حسابداری صفر (کوئری‌های balance قبلاً `deleted_at is null` را اعمال می‌کنند؛ دادهٔ تاریخی دست‌نخورده می‌ماند).
- **تست/نتیجه:** `SEC/M-02 Accounts` ✅.

### M-03 — پرداخت اتمیک قسط
- **Before:** خواندن قسط → `postEntry` (تراکنش خودش) → به‌روزرسانی قسط در write دوم → ناهماهنگی پول/وضعیت هنگام خطا + امکان دو پرداخت هم‌زمان.
- **تغییر:** یک تراکنش: `SELECT … FROM installments WHERE id=:id FOR UPDATE` → راستی‌آزمایی مالکیت در خودِ کوئری (`debt.user_id = :uid OR NULL` legacy) → پیش‌شرط‌ها → `postEntry(payload, tx)` → به‌روزرسانی قسط/متادیتا → settle بدهی — COMMIT/ROLLBACK واحد. بدون تغییر در `postEntry`.
- **تست/نتیجه:** `SEC/M-03` ✅ (replay بدون سند دوم؛ شکست پیش‌شرط با rollback کامل).

### M-04 — race ابطال
- **Before:** `reverseEntry` وضعیت را در تراکنش می‌خواند اما بدون قفل؛ دو ابطال هم‌زمان می‌توانستند هر دو از چک status بگذرند.
- **تغییر:** قفل رکورد سند در ابتدای همان تراکنش موجود (`FOR UPDATE`) + انتقال شرطی `posted→void` با راستی‌آزمایی سطر برگشتی (rollback در غیر این صورت). دقیقاً یک ابطال — بدون هیچ تغییر در منطق معکوس‌سازی/FIFO.
- **تست/نتیجه:** `SEC/M-04` ✅ (۵ هم‌زمان → ۱ موفق).

### L-01 — هدرهای امنیتی
- **تغییر:** `next.config.ts` — CSP کامل (`default-src 'self'`، `font-src 'self' data:`، منابع Google Identity در allowlist، `object-src 'none'`، `base-uri/form-action 'self'`) + `nosniff` + `Referrer-Policy: strict-origin-when-cross-origin` + `Permissions-Policy`؛ و **فقط در production**: `X-Frame-Options: SAMEORIGIN`، `frame-ancestors 'self'`، HSTS (تا پیش‌نمایش‌های iframe در dev نشکنند و HSTS روی originهای غیر production ست نشود).
- **تست/نتیجه:** smoke production/dev ✅ (هر دو حالت با curl راستی‌آزمایی شدند).

### L-02 — حذف CDN فونت
- **تغییر:** چهار فونت Vazirmatn v33.003 (عیناً فایل‌های vazirmatn@33.0.3 رسمی npm = تگ v33.003 روی GitHub) به `public/fonts/` منتقل و `@font-face`ها به `/fonts/…` بازنویسی شدند؛ شاخهٔ کش CDN در SW حذف شد.
- **تست/نتیجه:** build صفر ارجاع jsdelivr؛ سرو ۲۰۰ فونت ✅.

### L-03 — ایزولاسیون کش روی دستگاه مشترک
- **Before:** SW صفحات HTML خصوصی را network-first کش می‌کرد ⇒ کاربر بعدی دستگاه مشترک می‌توانست صفحات کاربر قبلی را ببیند.
- **تغییر:** `pwos-v2`: حذف کامل کش صفحات (آفلاین فقط پوستهٔ `/offline`)، حذف هرچیزی cross-origin، پاک‌سازی cacheهای نسخهٔ قدیمی هنگام activate، پیام `PURGE_CACHES` + پاک‌سازی مستقیم `caches.*` هنگام خروج و (دفاع دون‌عمق) پس از ورود/ثبت‌نام/Google.
- **تست/نتیجه:** محتوای SW جدید + غیاب CDN ✅.

### Next.js 16.2.11 → 16.3.0
- **تغییر:** `next`/`eslint-config-next` به 16.3.0، `postcss` به 8.5.26، `npm audit fix` (nanoid). `sharp` به نسخهٔ وصله‌شده (≥0.35، رفع CVEهای libvips) از مسیر وابستگی Next ارتقا یافت.
- **راستی‌آزمایی:** typecheck/lint/build/۱۹۲-تست روی نسخهٔ جدید هم سبز ⇒ ارتقا حفظ شد (در غیر این صورت طبق دستور revert می‌شد). باقی‌مانده: ۴ moderate مربوط به esbuild در زنجیرهٔ dev-only `drizzle-kit`.
