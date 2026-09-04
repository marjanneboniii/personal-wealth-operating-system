# گزارش ممیزی (AUDIT) — توازن / Personal Wealth Operating System

**تاریخ ممیزی:** ۲۰۲۶-۰۹-۰۴ · **کامیت بررسی‌شده:** `261264d` (`main`, "fix(portfolio): Toman-canonical valuation for IRT-denominated assets (#110)")
**دامنه:** ممیزی کامل پوشه‌ها و فایل‌ها + مسیر «خرید/فروش دارایی» و «حساب‌ها» — **فقط گزارش؛ هیچ کد، اسکیما، مهاجرت یا داده‌ای تغییر نکرد.**

> روش کار: (۱) فهرست‌برداری کامل درخت فایل (۵۵۲ فایل بدون `node_modules`)، (۲) ردیابی مسیر نوشتن از UI تا دیتابیس لایه‌به‌لایه، (۳) اجرای سه هارنس موقت روی PGlite (`DATABASE_URL=memory://`) برای **بازتولید عددی رفتار واقعی** اپ (هارنس‌ها پس از گرفتن خروجی حذف شدند؛ هیچ فایل آزمون یا داده‌ای در مخزن باقی نمانده است)، (۴) typecheck / lint / اجرای زیرمجموعه‌ای از تست‌ها.

| متریک سلامت | نتیجه |
|---|---|
| `tsc --noEmit` | ✅ ۰ خطا |
| `eslint .` | ✅ ۰ خطا، ۱ هشدار (`src/app/setup/page.tsx:128` — `react-hooks/exhaustive-deps`) |
| تست‌های هستهٔ مالی (۶۸ تست از ۶۵ فایل، زیرمجموعهٔ هدفمند) | ✅ ۶۸ pass / ۰ fail |
| فایل‌های تست | ۶۵ فایل، ۱۷٬۷۲۰ خط |
| جداول اسکیما | ۶۳ جدول، ۸۰ ایندکس/قید |
| کامیت‌های مخزن | ۱ (تاریخچه فشرده) |

**حکم کلی:** این یک **دفترکل دوطرفهٔ واقعی و تغییرناپذیر** است، نه یک اپ «موجودیت‌دار». جمع کنترلی `Σ base_value = 0` در همهٔ سناریوهای خرید/فروش/ابطال برقرار ماند و محافظ‌های FIFO/بیش‌فروش درست کار کردند. با این حال **۴ نقص محاسبه‌ای/امنیتیٔ تأییدشده با شاهد عددی** پیدا شد که همگی در همان مسیر خرید/فروش و ماژول حساب‌ها هستند (بخش ۱۲: F-01 … F-04).

---

## ۱) نقشهٔ کامل پوشه‌ها و فایل‌ها

| پوشه | فایل | خط | نقش | نکتهٔ ممیزی |
|---|---:|---:|---|---|
| `src/domain` | ۳ | ۳۰۹ | هستهٔ خالص مالی: `decimal.ts` (BigInt/۱۸ رقم)، `accounting.ts` (`assertBalanced`)، `fifo.ts` (`consumeFifo`) | بدون وابستگی به Next/Drizzle؛ تنها منبع حقیقت ریاضی. هیچ نقطه‌ضعفی دیده نشد. |
| `src/db` | ۷ | ۳٬۹۱۱ | `schema.ts` (۶۳ جدول)، `index.ts` (PG/PGlite)، `init-schema.ts` (DDL)، `seed.ts`، مهاجرت‌های داده | seed فقط در `APP_MODE=development`؛ production روی `memory://` Fail-Closed است. |
| `src/features` | ۶۶ | ۱۵٬۰۴۳ | Use-Caseها: `ledger` (تنها مسیر نوشتن)، `accounts`، `portfolio` (ارزش‌گذاری/خواندن)، `rwa/*` (ملک، خودرو، کالاکد)، `pricing`، `categories`، `planning`، `analytics`، `integrity`، `fx`، `valuation` | معماری read/write به‌روشنی جداست؛ لایهٔ ارزش‌گذاری هیچ تابع نوشتنی ندارد. |
| `src/app` | ۵۷ | ۱۰٬۰۰۵ | ۳۵ صفحه + `actions.ts` (Server Actions) + ۴ فایل actions تخصصی + ۱۰ مسیر API | فایل مرکزی `actions.ts` = ۱٬۴۳۵ خط؛ `createTransactionAction` تنها ۴۲۳ خط (نامزد شکستن). |
| `src/components` | ۵۹ | ۱۰٬۹۸۶ | Design System، فرم‌ها، جدول دارایی‌ها، ماژول‌های registry، نمودارهای SVG | `TransactionForm.tsx` = ۱٬۰۰۹ خط (هر ۶ نوع تراکنش در یک فایل). |
| `src/lib` | ۱۴ | ۲٬۳۹۹ | `format.ts` (ارز/جاوا/ارقام فارسی)، `fx.ts`، `validation.ts`، `audit.ts`، `auth*.ts`، `rateLimit.ts`، `tx.ts` | الگوی Fail-Closed در همهٔ مرزها یکدست رعایت شده. |
| `src/i18n` | ۳ | ۱۲۰ | `fa.ts` / `en.ts` / `index.ts` | عملاً فقط ۱۲۰ خط — بیشتر متن‌ها still inline در صفحات‌اند؛ i18n در عمل فعال نیست. |
| `src/scripts` | ۷ | ۸۳۰ | `migrate`, `seed`, `check-db`, `db-inspect-readonly`, `repair-migration-baseline`, `migrate-multiuser`, `migrate-debt-toman` | ابزار عملیاتی سالم و خواندنی. |
| `drizzle` | ۲۳ | ۱٬۱۷۲ | ۱۱ مهاجرت SQL (۰۰۰۰…۰۰۱۰) + snapshot‌ها | ۰۰۱۰ آخرین مهاجرت (نرخ ارز اصلی اقساط). |
| `tests` | ۶۵ | ۱۷٬۷۲۰ | node:test + PGlite، بدون Postgres واقعی | پوشش قوی؛ اما ۳ شکاف مهم (بخش ۱۵). |
| `docs` | ۱۸ | ۳٬۷۱۳ | ۶ ممیزی قبلی + DESIGN + سیستم طراحی + برنامه‌ها | `docs/AUDIT-FINANCIAL-LOGIC-2026-08-21.md` ۴ مورد از مشکلات امروز را از قبل پیش‌بینی کرده بود. |
| `public` | ۱۷۵ | — | ۱۶۰ آیکون SVG ایرانی (بانک/خودرو/برند/صرافی/بیمه/کریپتو) + ۵ وزن Vazirmatn + `sw.js` + manifest | PWA کامل؛ هیچ دارایی غیرمجازی در snapshot نیست. |
| `brand` | ۳۸ | — | لوگو/آیکون/برند‌بورد + `راهنمای-برند.md` | خارج از باندل اجرایی (فقط منبع). |
| ریشه | ۱۲ | — | `README.md`، ۴ گزارش (`REPORT`, `FIX_REPORT`, `SECURITY-REMEDIATION-REPORT`, `AUDIT-REAL-ESTATE-CLEANUP`)، `.env.example`، `next.config.ts`، `tsconfig`، `eslint`، `postcss`، `drizzle.config` | ۴ فایل گزارش در ریشه + ۶ فایل در `docs/` ⇒ پراکندگی مستندات (پیشنهاد P-07). |

### ۱-الف) مسیرهای صفحه (۳۵ route) و نقش هرکدام در خرید/فروش

| مسیر | عنوان | اثر خرید/فروش |
|---|---|---|
| `/` | نمای کلی (Overview) | نشان می‌دهد: فعالیت اخیر + میان‌بر «ثبت خرید/فروش دارایی» |
| `/accounts` | **حساب‌ها** | ✅ ماندهٔ هر دو حساب (نقد و دارایی) — بخش ۱۰ |
| `/assets` | **همه دارایی‌ها** | ✅ ردیف دارایی، ارزش روز، بهای تمام‌شده، سود تحقق‌نیافته، سهم |
| `/assets/financial` | دارایی‌های مالی | ✅ سطل‌ها (نقد/رمزارز/سهام/صندوق/سایر) + سود محقق‌شده |
| `/assets/real` | دارایی‌های واقعی | ↪ redirect به `/asset-registry` (بدون منبع حقیقت دوم) |
| `/portfolio` | سبد دارایی | ✅ ۴ متریک + دونات ترکیب + جدول ارزش‌گذاری + P&L محقق‌شده |
| `/crypto` | رمزارزها | ✅ جدول هولیدینگ + تفکیک امانت‌داری (custody) از ماندهٔ حساب‌ها |
| `/net-worth` | ارزش خالص | ✅ ارزش دارایی‌ها منهای بدهی (سری + Change Attribution) |
| `/ledger` | سوابق مالی | ✅ سند دوطرفه با بدهکار/بستانکار (Pro Mode) + فریز نرخ |
| `/transactions` | تراکنش‌ها | ✅ ردیف «خرید دارایی»/«فروش دارایی» + برچسب مقدار دارایی |
| `/new` | ثبت تراکنش | 🖊️ **محل ثبت** خرید/فروش (فرم + پیش‌نمایش) |
| `/asset-registry` | دارایی واقعی و کالا | 🖊️ ثبت ملک/خودرو/طلا/کالا + ارزش‌گذاری (مسیر موازی، بخش ۱۰) |
| `/debts` · `/debts/loans` · `/debts/installments` · `/debts/obligations` · `/installments` | بدهی/اقساط/تعهدات | فقط مصرفی (بازپرداخت) — به خرید/فروش ربطی ندارد |
| `/cash-flow` · `/budgets` · `/goals` · `/planning` · `/reports` · `/analytics` · `/insights` · `/financial-records` | گزارش و برنامه‌ریزی | خرید **هیچ اثری** روی جریان نقدی ندارد؛ فروش فقط به اندازهٔ سود/زیان (بخش ۹) |
| `/audit` | حسابرسی و یکپارچگی | ✅ ۷ آزمون زنده + ۱۵ رویداد آخر `audit_log` |
| `/settings` · `/setup` · `/login` · `/register` · `/about` · `/privacy` · `/terms` · `/offline` · `/app` | بستر | نرخ ارز، حالت حرفه‌ای، احراز هویت، راه‌اندازی |

### ۱-ب) API‌ها

| مسیر | متدها | نکته |
|---|---|---|
| `/api/transactions` | GET/PUT/DELETE/POST | POST **فقط** `income` / `expense` / `transfer` — «از این وب‌سرویس پشتیبانی نمی‌شود» برای buy/sell. DELETE فیزیکی ممنوع؛ فقط `reverseEntry`. |
| `/api/accounts` | GET/PUT/DELETE | DELETE هوشمند: اگر حساب `postings` یا `lots` داشته باشد ⇒ **archive** (`isActive=false, deletedAt`)، وگرنه حذف فیزیکی. |
| `/api/lots` | GET | فقط خواندنی، با فیلتر مالکیت |
| `/api/fx/latest` · `/api/fx/rate` | GET | نرخ مرجع برای پیش‌نمایش زندهٔ فرم |
| `/api/backup` · `/api/restore` · `/api/health` | GET/POST | پشتیبان JSON نسخه‌دار / بازیابی تراکنشی اتمیک |
| `/api/auth/google` · `/api/auth/logout` | POST | هویت Google + نشست |

### ۱-ج) ۶۳ جدول، گروه‌بندی‌شده

| گروه | جداول | نکته |
|---|---|---|
| مرجع | `currencies`, `asset_classes` (سلسله‌مراتبی), `networks`, `institutions`, `assets`, `wallets`, `expense_categories` | جای enum ⇒ جدول مرجع؛ `assets.symbol` یکتا |
| هستهٔ حسابداری | `accounts`, `journal_entries`, `postings`, `entry_reviews`, `entry_fx_snapshots` | **هیچ ستون موجودی وجود ندارد** |
| FIFO | `lots`, `lot_consumptions` | `qty_opened = qty_remaining + Σ consumed` |
| بازار/ارزش‌گذاری | `prices`, `coingecko_asset_catalog`, `coingecko_price_cache`, `portfolio_valuations`, `portfolio_snapshots`, `asset_performance`, `asset_performance_analysis`, `wealth_performance_snapshots`, `portfolio_risk_metrics`, `benchmark_*`, `analytics_runs`, `snapshots`, `snapshot_lines` | هیچ FK‌ای به `journal_entries`/`postings`/`lots` ندارند ⇒ تغییر قیمت هرگز سند را بازنویسی نمی‌کند |
| برنامه‌ریزی | `goals`, `goal_contributions`, `events`, `event_items`, `budgets`, `planned_transactions`, `debts`, `installments`, `obligations`, `funds` | تا لحظهٔ «اجرا» بی‌اثرند |
| RWA | `cities`, `neighborhoods`, `property_types`, `real_estate_properties`, `real_estate_valuation_snapshots`, `vehicle_brands`, `vehicle_catalog`, `vehicle_assets`, `vehicle_valuation_snapshots`, `rwa_ownership_records`, `rwa_valuation_events`, `commodity_*` | Snapshotها فقط-افزودنی با ایندکس یکتا |
| پلتفرم | `users`, `sessions`, `settings`, `notifications`, `audit_log`, `user_setup_state`, `backup_runs`, `exchange_rates`, `user_fx_settings`, `user_preferences` | — |

---

## ۲) اصول بنیادینی که ممیزی تأیید می‌کند (PASS)

1. **تک‌مسیرهٔ نوشتن:** همه‌چیز از `postEntry()` عبور می‌کند (`src/features/ledger/service.ts:144`) — انتقال، خرید، فروش، درآمد، هزینه، بازپرداخت، اجرای پلن، افتتاحیه.
2. **تراز اجباری:** `assertBalanced()` قبل از هر درج: حداقل ۲ ردیف و `|Σ base_value| ≤ 1e-9` (`src/domain/accounting.ts:66`).
3. **موجودیت محاسبه‌ای، نه ذخیره‌ای:** همهٔ مانده‌ها `SUM(postings)` (`getAccountBalances`, `src/features/ledger/queries.ts:94`).
4. **ابطال به‌جای حذف:** `reverseEntry()` سند معکوس می‌سازد، اصلی را `void` می‌کند، لاها را بازمی‌گرداند و **اگر بخشی از لا مصرف شده باشد رد می‌کند** (`service.ts:397-460`).
5. **Idempotency:** کلید + `canonicalizePayload` (SHA-256 مرتب‌شده) ⇒ replay ⇒ `200` و بی‌اثر؛ همان کلید با payload دیگر ⇒ `409`.
6. **قفل ترتیبی:** `SELECT … FOR UPDATE` روی حساب‌ها به ترتیب ID (ضد بن‌بست) و روی لاها به ترتیب `opened_at`.
7. **فریز تاریخی:** `entry_fx_snapshots` در همان تراکنش نوشته می‌شود (تومان + دلار + نرخ + منبع + تاریخ نرخ) و بعداً هرگز بازمحاسبه نمی‌شود.
8. **تفکیک نوع تراکنش:** `buy`/`sell` هرگز «هزینه/درآمد» نیستند؛ بازپرداخت بدهی جداست؛ انتقال بین‌حسابی جداست.
9. **حالت حرفه‌ای (Pro Mode):** واژگان بدهکار/بستانکار/کد معین فقط با انتخاب کاربر — پیش‌فرض ساده.
10. **Fail-Closed امنیتی:** در `getAuthContext`, `resolveServiceUserId`, `validateAccountOwnership`, `assertProductionDatabaseConfig` — خطای دیتابیس/احراز هویت ⇒ **رد**، نه دسترسی ناشناس.

---

## ۳) «حساب» در این سیستم دقیقاً چیست؟

سه مفهوم جدا (و به‌درستی جدا) وجود دارد:

| مفهوم | جدول | نقش |
|---|---|---|
| ظرف/محل نگهداری | `wallets` (kind: bank/cash/exchange/hot/cold/fund) | برچسب user-facing، آیکون بانک/صرافی |
| حساب معین (دفترکل) | `accounts` (type: asset/liability/equity/income/expense + `code`) | **همین ردیف** در ماژول حساب‌ها ظاهر می‌شود و `SUM(postings)` می‌گیرد |
| واحد بومی حساب | `accounts.asset_id → assets` | IRT/USD/USDT = «واحد»؛ BTC/ETH/… = «دارایی قابل معامله» |

### ثبت حساب پولی (`/accounts → افزودن حساب جدید`)
`createMoneyAccountAction` (`src/app/actions.ts:173`) → `registerMoneyAccount()` (`src/features/accounts/service.ts:300`) — **یک تراکنش اتمیک با ۵ نوشتار:**

1. اعتبارسنجی: ارز حساب **فقط** `IRT | USD | USDT` (`MONEY_ACCOUNT_CURRENCY_SET`) — هر چیز دیگر (ملک، خودرو، طلا، رمزارز نوسانی) در «واحد بومی حساب» رد می‌شود.
2. `wallets` درج می‌شود (کاربر-مختصر؛ `institutions` مشترک **دست‌نخورده** می‌ماند).
3. `accounts` با نوع `asset` و کد عددی خودکار: `nextAssetCode()` ⇒ `max(code)+10` با کف ۱۶۱۰، تا ۸ تلاش با `onConflictDoNothing` (رقابت‌پذیر).
4. اگر موجودی اولیه > ۰ باشد: **یک** `journal_entries(type='opening')` با دو `postings`:
   * `دارایی (حساب جدید) +X` / `سرمایه افتتاحیه 3010 −X`
   * `base_value` دلار: برای USD/USDT واحد=۱ دلار؛ برای IRT `تومان ÷ نرخ دلارِ همان کاربر` (`getLatestUsdIrtRateForUser`).
   * موجودی صفر ⇒ **هیچ سندی ثبت نمی‌شود** (حساب خالی ساخته می‌شود).
5. `recordAuditEvent(CREATE_MONEY_ACCOUNT)`.

⚠️ **نکتهٔ طراحی که در خرید/فروش مهم می‌شود:** حساب پولی هیچ لا (FIFO lot) باز نمی‌کند — لاها منحصراً مالِ `buy` هستند.

---

## ۴) خرید دارایی — دقیقاً چه اتفاقی می‌افتد (۱۴ مرحله)

مسیر: `/new?type=buy` → `TransactionForm` → `createTransactionAction` (`src/app/actions.ts:392`) → `recordBuy` (`service.ts:805`) → `postEntry` (`service.ts:144`).

| # | مرحله | کد | نتیجهٔ قابل مشاهده |
|---|---|---|---|
| ۱ | احراز هویت Fail-Closed | `actions.ts:394-404` | بدون نشست ⇒ «برای ثبت تراکنش ابتدا وارد شوید» |
| ۲ | اگر دارایی تازه است: ثبت هویت + حساب | `registerMarketAssetAction` (`app/actions/pricing.ts:47`) | یک ردیف `assets` (pricingMethod=`coingecko`) **و** یک ردیف `accounts` با کد `MKT-<SYMBOL>-<id…>` بدون `wallet_id` |
| ۳ | اعتبارسنجی ورودی (zod) | `txSchema` (`actions.ts:367`) | نوع/تاریخ/شرح/مبلغ الزامی |
| ۴ | **IDOR guard** | `validateAccountOwnership` ×۲ (`actions.ts:425-431`) | هر حسابِ نه‌شما ⇒ 403 و **هیچ** اثر نوشتاری |
| ۵ | نرخ دلار سمت سرور | `getLatestUsdIrtRateForUser` (اولویت: `user_fx_settings` → `exchange_rates` → `settings.irt_rate` → fallback `190000`) | نرخ ارسالی کلاینت نادیده گرفته می‌شود |
| ۶ | تبدیل مبلغ | `usd = irtAmount / rate` | «مبلغ به تومان» ورودی اصلی، دلار مشتق |
| ۷ | کارمزد | `feeUsd = feeIrt / rate` | — |
| ۸ | اجبار نوع حساب | هر دو حساب باید `type='asset'` باشند | «حساب دارایی نامعتبر است…» |
| ۹ | استخراج دارایی/مقدار | `assetId = accounts.asset_id(primaryAccount)`؛ `qty` از کاربر (اجباری)؛ `cashQuantity = usd / nativeUnitPrice(cashAccount)` | قیمت واحد بومی از `nativeUnitPriceUsd` (`features/fx/unitPrice.ts`) |
| ۱۰ | ساخت سند خرید | `recordBuy` | ۲ یا ۳ ردیف: دارایی `+value` · نقد `−(value+fee)` · (اختیاری) کارمزد `+fee` روی `5040` |
| ۱۱ | نوشتن در دفترکل | `postEntry` | `journal_entries(type='buy')` + `postings` + **`lots`** (`qty_opened=qty_remaining=qty`, `unit_cost_base=(value+fee)/qty`) |
| ۱۲ | فریز تاریخی | `entry_fx_snapshots` (`actions.ts:744`) | تومان + دلار + نرخ + منبع + تاریخ نرخ **در همان TX** |
| ۱۳ | بازبینی خودکار | `entry_reviews` (`actions.ts:754`) | «ثبت دستی = انسانی تأیید کرده» |
| ۱۴ | ممضا + رندر مجدد | `audit_log`: `post_entry` **و** `CREATE_ASSET_BUY` · `refreshAll()` (۱۶ مسیر) | صفحه بلافاصله به‌روز می‌شود |

**خوانا روی کاغذ (خرید ۱ ETH به ۵۷۰٬۰۰۰٬۰۰۰ تومان، نرخ ۱۹۰٬۰۰۰):**

```
journal_entries: buy | 2026-09-04 | «خرید ۱ اتریوم» | posted | manual
postings:
  MKT-ETH  اتریوم (ETH)   qty=+1 ETH          base=+3000 USD   ← بهای تمام‌شده
  1010     بانک ملت        qty=−570٬000٬000 تو base=−3000 USD
lots:       opened=2026-09-04  qty_opened=1  qty_remaining=1  unit_cost_base=3000
entry_fx:   irt=570٬000٬000  usd=3000  rate=190٬000  source=fallback  rate_date=2026-09-04
```

### نکات رفتاری مهمِ مسیر خرید
* خرید **هیچ هزینه‌ای** نمی‌سازد (جز کارمزد روی `5040`) و **جریان نقدی را تغییر نمی‌دهد** (`getCashflow` فقط حساب‌های `income`/`expense` را می‌شمارد ⇒ یک خرید خالصِ جابه‌جایی درونِ دارایی‌هاست: ارزش خالص ثابت).
* `preventOverdraft` در لایهٔ خدمات پیاده شده (`service.ts:205`) ولی **هیچ فراخوانی آن را true نمی‌دهد** ⇒ می‌توان بیشتر از موجودی خرید کرد و حساب بانکی منفی می‌شود (شاهد: F-06).
* لا (Lot) با **`entryDate`** باز می‌شود، نه تاریخ امروز ⇒ ترتیب FIFO به تاریخ سند پایبند است.

---

## ۵) فروش دارایی — دقیقاً چه اتفاقی می‌افتد (۱۲ مرحله)

| # | مرحله | کد |
|---|---|---|
| ۱ | همان گاردهای احراز هویت/IDOR/zod | `actions.ts:394-431` |
| ۲ | نرخ سرور + تبدیل `usd = irt/rate` | `actions.ts:440-455` |
| ۳ | اجبار `qty` و حساب‌های نوع `asset` | `actions.ts:703-712` |
| ۴ | یافتن حساب سود: `code='4100'` | `actions.ts:735` ⚠️ (F-03) |
| ۵ | **پیش‌نمایش FIFO** (برای تعیین بهای تمام‌شدهٔ واقعی) | `consumeFifo(open, qty, proceeds−fee)` (`service.ts:909`) |
| ۶ | ردیف‌های سند: دارایی `−costBasis` (memo «خروج به بهای تمام‌شده (FIFO)») · نقد `+netProceeds` · سود `−realized` روی `4100` · (اگر کارمزد) `5040 +fee` و **یک ردیف نقدِ دوم `−fee`** | `service.ts:921-966` |
| ۷ | `postEntry(type='sell')` ⇒ `journal_entries` + `postings` | `service.ts:144` |
| ۸ | **مصرف لاها:** قفل `FOR UPDATE` ⇒ دوباره `consumeFifo` داخل TX ⇒ `UPDATE lots.qty_remaining` + درج `lot_consumptions` (qty/cost/proceeds/realized) | `service.ts:304-352` |
| ۹ | **محافظ بیش‌فروش:** `unmatchedQty > 1e-9` ⇒ خطا و **rollback کل تراکنش** | `service.ts:326-328` |
| ۱۰ | فریز `entry_fx_snapshots` + `entry_reviews` | `actions.ts:744-754` |
| ۱۱ | `audit_log`: `post_entry` + `CREATE_ASSET_SELL` | `service.ts:355-390` |
| ۱۲ | سود تحقق‌نیافته **هرگز** ثبت نمی‌شود؛ فقط در لایهٔ گزارش محاسبه می‌گردد | `features/portfolio/*` |

**خوانا روی کاغذ (فروش ۰٫۵ ETH به ۳۸۰٬۰۰۰٬۰۰۰ تومان با کارمزد ۱۹٬۰۰۰٬۰۰۰):**

```
proceeds=2000 USD  fee=100 USD  netProceeds=1900  costBasis=1500  realized=400
postings:
  MKT-ETH  qty=−0.5 ETH          base=−1500   «خروج به بهای تمام‌شده (FIFO)»
  1010     qty=+380٬000٬000 تو   base=+1900
  4100     qty=−400              base=−400    «سود/زیان تحقق‌یافته»
  5040     qty=+100              base=+100    «کارمزد معامله»
  1010     qty=−100              base=−100    «کسر کارمزد»      ← ⚠️ شمارش دوبارهٔ کارمزد (F-01)
lots:              qty_remaining: 1 → 0.5
lot_consumptions:  qty=0.5  cost=1500  proceeds=1900  realized=400
getRealizedPnl():  { total: "400", bySymbol: [{ symbol: "ETH", pnl: "400" }] }   ✅
```

---

## ۶) پس از خرید/فروش، در **ماژول حساب‌ها** چه نمایش داده می‌شود؟

منبع داده: `getAccountBalances(userId)` (گروه‌بندی `SUM` روی `postings` با `je.status='posted'`) → صفحه `/accounts`.

| بلوک UI | فرمول | بعد از **خرید** | بعد از **فروش** |
|---|---|---|---|
| Metric «ارزش پایه حساب‌های پول» | `Σ base_value` روی حساب‌های داراییِ دارای کیف‌پول یا مقدار≠۰ | **+ value** روی حساب دارایی، **− (value+fee)** روی نقد ⇒ جمع خالص = `−fee` | **+ (proceeds−fee−fee)** نقد، **− costBasis** دارایی |
| Metric «حساب‌های فعال» | شمارش `asset` + `liability` با ماندهٔ ≠۰ | حساب دارایی نو (مثلاً `MKT-ETH`) **اضافه** می‌شود | اگر مقدار به صفر برسد، از کارت‌ها **حذف** می‌شود (حساب می‌ماند) |
| Metric «جمع کنترلی دفتر» | `Σ base_value` روی **همهٔ** حساب‌ها؛ سبز اگر \|x\|<1e-6 | ۰ (✅) | ۰ (✅) — در همهٔ سناریوهای تست‌شده صفر ماند |
| کارت هر کیف‌پول | ردیف تکی با مبلغ اصلی + یک خط دوم | نقد: مبلغ تومان؛ دارایی (بدون کیف‌پول ⇒ کلید `account:<id>`، تیتر «بدون کیف‌پول»): خط اصلی = **ارزش تومانیِ `base_value`**، خط دوم = مقدار ذاتی | کسر موجودی نقد؛ برای IRT خط اصلی همان تومانِ کاننیکال |
| «حساب‌های بدهی» | `type='liability' && base≠0` | بی‌تغییر | بی‌تغییر (خرید/فروش بدهی نمی‌سازد) |
| «نمودار کامل حساب‌ها» (جزئیات) | فقط `income/expense/equity/liability` با مانده≠۰ | اگر کارمزد ثبت شود: `5040` با مبلغ | `4100` با **سود/زیان تحقق‌یافته** ظاهر می‌شود |
| «افزودن حساب جدید» | فرم `MoneyAccountForm` | — | — |

فرمول‌های نمایش (دقیقاً از `src/app/accounts/page.tsx`):

* `canonicalBalance`: IRT → `|quantity|` تومان · IRR → `|quantity|/10` · USDT/USD → `|quantity|` در واحد خودش · سایر → `formatMoney(|quantity|, symbol)`
* `valuationToman`: IRT/IRR → `null` (تومان خودش ارزش است؛ هیچ‌وقت بازنرخ نمی‌خورد) · USDT/USD → `|quantity| × نرخ امروز` · سایر → `|base_value| × نرخ امروز`
* **ارزش‌گذاری دارایی در این صفحه «بهای تمام‌شده» است، نه قیمت بازار** (چون از `base_value` خوانده می‌شود)؛ ارزش روز فقط در `/assets` و `/portfolio` است.

⚠️ سه نکتهٔ نمایشی (شاهددار):

1. همه‌جا `D(...).abs()` می‌گیرد (خطوط ۶۲، ۸۷-۹۲، ۹۹، ۱۶۵) ⇒ **حساب منفی (بیش‌برداشت) به‌صورت مثبت نمایش داده می‌شود**؛ هیچ هشدار قرمزی روی کارت نیست. (F-07)
2. فیلتر `moneyAccountsRaw` = «نوع asset با کیف‌پول یا مقدار≠۰» ⇒ هر هولیدینگ (حتی یک لا BTC) در «حساب‌های پول» شمرده می‌شود؛ تیتر `ارزش پایه حساب‌های پول` عملاً «جمع حساب‌های دارایی» است. (F-11)
3. در چند-مستأجری، حساب‌های مشترکِ `user_id IS NULL` (از جمله `1600`, `3015` که ماژول ملک خودشان می‌سازد) با `SUM(postings)` روی **مجموع همهٔ کاربران** خوانده می‌شوند. (F-04 — شاهد عددی در بخش ۱۲)

---

## ۷) پس از خرید/فروش، در **ماژول دارایی‌ها** چه نمایش داده می‌شود؟

منبع یکتا: `getPortfolioValuation()` (`src/features/portfolio/service.ts:350`) — **read-model خالص، بدون هیچ مسیر نوشتن** (سند/لا/حساب نمی‌سازد).

```
holdings(Σ postings به تفکیک دارایی) + openLots(بهای تمام‌شده) + prices/CoinGecko(قیمت روز)
        + realEstate/vehicle/ownership overlay (دارایی بدون مقدار دفتری)
        + entry_fx_snapshots(بهای تمام‌شدهٔ تومانی تاریخی)  →  AssetValuation[]
```

| ستون/متریک | فرمول واقعی | خرید ۱ ETH (۳۰۰۰ دلار) | فروش ۰٫۵ ETH (۲۰۰۰ دلار) |
|---|---|---|---|
| «تعداد دارایی» | `assetValuations.length` | +۱ (اگر دارایی تازه است) | بی‌تغییر؛ با صفر شدن مقدار **حذف** می‌شود (`activeHoldings` فیلتر `\|qty\|>1e-8`) |
| «ارزش کل دارایی‌ها» / «ارزش روز سبد» | `Σ currentValue` (USD) | +۳۰۰۰ (یا `qty × قیمت CoinGecko`) | مقدار باقی‌مانده بازنرخیابی می‌شود |
| «بهای تمام‌شده» | `Σ (qty_remaining × unit_cost_base)` از لاها؛ در نبود لا = `Σ postings` | +۳۰۰۰ | −۱۵۰۰ (سهمِ لأ مصرف‌شده) |
| «سود/زیان محقق‌نشده» | `currentValue − costBasis` (USD) و `currentValueToman − historicalCostToman` | ۰ اگر قیمت خرید = قیمت بازار | P&L تحقق‌نیافته روی باقی‌مانده |
| «سود تحقق‌یافته» | `getRealizedPnl()` ← `lot_consumptions.realized_pnl` | بی‌تغییر | **+۴۰۰** ✅ |
| «مقدار» | `Σ postings.quantity` برای آن دارایی | ۱ ETH | ۰٫۵ ETH |
| «قیمت بازار» | CoinGecko (اگر `pricingMethod='coingecko'`) → وگرنه `prices.price_base` → وگرنه ۱ | قیمت روز | قیمت روز |
| چیپ تازگی | `fresh` / `stale` / `unavailable` (TTL اینپروسس ۶۰s، `FRESH_TTL_MS`) | معمولاً `fresh` | اگر قیمت نرسد: `Unavailable` + Alert روی `/portfolio` |
| Chip «بهای تمام‌شده» تومانی | `costBasisToman = currentValueToman − unrealizedPnlToman` (سازگاری سه‌گانه در لایه نمایش) | سازگار | سازگار |
| «ترکیب بر اساس کلاس» / دونات | `Σ currentValue` به تفکیک `asset_classes.name` | کلاسهٔ دارایی رشد می‌کند | نقد رشد می‌کند |
| سهم هر ردیف | `currentValue ÷ totalNetWorth × 100` | — | — |

* `/assets` دارایی‌ها را با `REAL_ASSET_CLASSES = {دارایی واقعی, املاک, خودرو, طلا, کالا, RWA}` به دو خانواده تقسیم می‌کند؛ **نقد/تومان هم یک «دارایی» شمرده می‌شود** (کلاس `نقد و بانک`) ⇒ «ارزش کل دارایی‌ها» شامل پول نقد است.
* `/assets/financial` با `BUCKET_OF` سطل‌بندی می‌کند (نقد ← «نقد و بانک» و «استیبل‌کوین»، رمزارز، سهام، صندوق، سایر) و سود محقق‌شده را **فیلتر به نمادهای همان صفحه** می‌کند.
* `/crypto` علاوه بر جدول، «amanat-dari/custody» را از `getAccountBalances` و `walletName` می‌سازد ⇒ چون حساب کریپتوی `MKT-*` کیف‌پول ندارد، در تفکیک custody در «نامشخص» می‌نشیند.
* `/net-worth` از `getCurrentNetWorth` همان valuation را می‌خواند؛ لاگاریتم تاریخچه با `snapshots` (دکمهٔ «عکس لحظه‌ای») ساخته می‌شود.

---

## ۸) چه چیزهایی تغییر می‌کند / چه چیزهایی هرگز تغییر نمی‌کند

| مورد | خرید | فروش |
|---|---|---|
| `journal_entries` | +۱ (`type='buy'`) | +۱ (`type='sell'`) |
| `postings` | +۲ یا +۳ | +۳ (با کارمزد +۵) |
| `lots` | +۱ (باز) | `qty_remaining` کم می‌شود |
| `lot_consumptions` | — | +۱ به ازای هر لأ مصرف‌شده |
| `entry_fx_snapshots` | +۱ (فریز) | +۱ (فریز) |
| `entry_reviews` | +۱ | +۱ |
| `audit_log` | ۲ رویداد | ۲ رویداد |
| ماندهٔ حساب نقد | `−(value+fee)` | `+(proceeds−fee[−fee ← F-01])` |
| ماندهٔ حساب دارایی | `+value` | `−costBasis` |
| ارزش خالص | `−fee` (فقط کارمزد) | `±realized − fee` |
| جریان نقدی (`/cash-flow`) | بی‌تغییر | فقط به اندازهٔ `realized` (بخش ۹) |
| بودجه‌ها | بی‌تغییر | بی‌تغییر |
| بدهی/اقساط | بی‌تغییر | بی‌تغییر |
| قیمت‌ها (`prices`) / کاتالوگ CoinGecko | **دست‌نخورده** | **دست‌نخورده** |
| اسناد قبلی | **ویرایش/حذف هیچ‌وقت** | همان |

---

## ۹) تعامل با گزارش‌ها (نکات دقیق)

* `getCashflow` جریانات را از حساب‌های `income/expense` می‌شمارد ⇒ در **فروش**، عددِ ورودی نقدی **فقط سود/زیان تحقق‌یافته** است (نه کل وجه دریافتی)؛ اگر سود صفر باشد، آن فروش در نمودار جریان نقدی اصلاً خط ندارد؛ اگر فروش با **زیان** باشد، `inflow` منفی می‌شود. (F-12)
* Toman در جریان نقدی از `entry_fx_snapshots` خوانده می‌شود و در پوشش ناقص به نرخ جاری «≈» برمی‌گردد (منطقی و مصون از بازنویسی).
* `analytics/capitalFlows` فقط «deposit/withdrawal/opening» را جریان سرمایه بیرونی می‌داند و **فروش دارایی را جریان بیرونی نمی‌شمارد** — سازگار با §۲.۸.
* `insights`/`reports` از همان valuation تغذیه می‌شوند؛ هیچ منبع حقیقت دوم ندارند.

---

## ۱۰) مسیرهای موازی خرید/فروش و تفاوت‌هایشان (مهم‌ترین بخش برای یکپارچگی محصول)

| مسیر | سند دفتری | لا (FIFO) | اثر در ماژول حساب‌ها | اثر در ماژول دارایی‌ها |
|---|---|---|---|---|
| **تراکنش «خرید دارایی» / «فروش دارایی»** (`/new`) | ✅ `buy`/`sell` | ✅ | ✅ حساب نقد و حساب دارایی | ✅ مقدار/بها/P&L |
| **ثبت ملک** (`/asset-registry`, `saveRealEstateAction` → `createRealEstateAsset`) | ✅ یک `opening` با تاریخ **ملکیت واقعی**: `1600 (املاک) +` / `3015 (سرمایه افتتاحیه تملک‌های تاریخی) −`، کلید `real-estate-acquisition:<assetId>` (Idempotent) | ❌ (مقدار همیشه ۱) | ✅ اما در حساب **مشترک جهانی** (F-04) و بدون کیف‌پول | ✅ از جدول overlay (`real_estate_*`) + `prices` ارزش‌گذاری |
| **ثبت خودرو** (`saveVehicleAction` → `createUserVehicle`) | ❌ **هیچ سندی** — فقط `assets` + `vehicle_assets` | ❌ | ❌ **در ماژول حساب‌ها هیچ ردیفی ظاهر نمی‌شود** | ✅ از آخرین Snapshot (و `status='sold'` ⇒ از ارزش‌گذاری بیرون می‌افتد) |
| **فروش خودرو** (`sellVehicle`) | ❌ فقط `UPDATE vehicle_assets` (`status='sold'`, `sale_price_toman`, نرخ/دلار فریزشده) | ❌ | ❌ | حذف از سبد؛ P&L فقط به‌صورت `gainToman/gainUsd` در ماژول خودرو | 
| **دارایی واقعی عمومی/طلا** (`saveRwaAction`, `commodities`) | ❌ (`assets` + `rwa_ownership_records` + `rwa_valuation_events`) | ❌ | ❌ | ✅ overlay از `rwaOwnershipRecords` |
| **اجرای پلن** (`executePlanAction`) | ✅ از همان `postEntry` (`source='plan'`) | فقط اگر buy/sell باشد | ✅ | ✅ |
| **پرداخت قسط** | ✅ `installment`/`debt_repayment` + فریز پرداخت روی `installments` | ❌ | ✅ | فقط نقد |
| **REST `POST /api/transactions`** | ✅ ولی **بدون buy/sell** | — | ✅ | ❌ (دارایی دست‌نخورده) |

**پیامد:** امروز «فروش یک دارایی» دو حقیقت دارد — در سبد دارایی و `/net-worth` ظاهر می‌شود، اما در دفترکل هیچ اثری ندارد. این دقیقاً همان چیزی است که باید در اولویت اصلاح باشد (F-08).

---

## ۱۱) ابطال/اصلاح یک خرید یا فروش (رفتار تأییدشده)

`reverseEntry(entryId)` (`service.ts:397`) — قفل ردیف ⇒ اگر لاها مصرف شده باشند **رد** می‌شود با پیام «ابتدا تراکنش‌های فروش بعدی را ابطال کنید» ⇒ در غیر این صورت لاها `qty_remaining=0`، مصرف‌ها برگشت و `lot_consumptions` حذف، سند `adjustment` با `status='void'` و `reversal_of` درج، و اصلی `posted→void` به‌صورت شرطی.
✅ تست‌های `db-integration` و `fifo-reversal` سبز بودند؛ **اما** سند معکوس و `void`شدنِ ردیف اصلی، `entry_fx_snapshots` را پاک نمی‌کند و `audit_log` رویداد `reverse_entry` را **بدون `userId`** می‌نویسد. (F-13)

---

## ۱۲) یافته‌ها (با شاهد عددی/کد)

> شدت‌ها: Critical / High / Medium / Low. «شاهد» = خروجی اجرای واقعی روی PGlite یا ارجاع خط.

### F-01 · High — شمارش دوبارهٔ کارمزد در فروش (نقد کمتر از دریافت واقعی)
`recordSell` یک‌بار `netProceeds = proceeds − fee` را به حساب نقد می‌دهد (`service.ts:933`) و سپس در بلوک کارمزد دوباره `−fee` روی همان حساب نقد ثبت می‌کند (`service.ts:960-964`).
**شاهد:** با `proceeds=2000, fee=100` مجموع base حساب نقد `+1800` شد (باید `+1900`)؛ در نتیجه ارزش خالص `−100` بیشتر از واقع کم می‌شود، درحالی‌که `lot_consumptions.proceeds_base = 1900` است ⇒ **دفتر و FIFO با هم نمی‌خوانند.**
مسیر خرید این نقص را ندارد (یک بار روی نقد).

### F-02 · High — «خرید با کارمزد» روی نصب تازه شکست می‌خورد (و فروش بی‌صدا کارمزد را می‌بلعد)
`recordBuy` حساب کارمزد را با `code='5040'` پیدا می‌کند؛ اگر نبود **ردیف کارمزد ساخته نمی‌شود** ولی `−(value+fee)` روی نقد باقی می‌ماند ⇒ `assertBalanced` می‌ترکد.
**شاهد:** `RESULT: buy with fee THREW → سند تراز نیست. اختلاف در ارز پایه: -10.000000`
در همان دیتابیس، `sell` با کارمزد بدون `5040`: `SUCCEEDED (fee silently absorbed)` ⇒ رفتار ناهمگونِ دو مسیر.
علت ریشه‌ای: `completeSetup()` نمودار حساب را می‌سازد اما **`5040` در آن نیست** (`src/features/setup/service.ts:322-342` فقط 1000/1010/1020/1200/1300/2000/2010/3000/3010/3200/4000/4010/4100/5000/5010/5020/5900)؛ `5040`/`5030`/`5050`/`4900` فقط در `src/db/seed.ts:254` وجود دارند که در production اجرا نمی‌شود.

### F-03 · High — حساب `4100` و `5040` بدون فیلتر مستأجر انتخاب می‌شوند (سوءانتساب بین‌کاربری)
`actions.ts:735` → `select … from accounts where code='4100' limit 1` و `actions.ts:677/696/717` → همان برای `5040` — هیچ `user_id` در `where` نیست و `order by` هم نیست.
**شاهد (دو کاربر واقعی در یک دیتابیس):**
```
lookup of code '4100' (no tenant filter) returned → سود علی | owner: ALI (u1)
4100 balances per owner: [{"username":"ali","balance":"-500"}]   ← سودِ «سارا» در حساب «علی»
```
کاربر B سودش را در ماژول حساب‌ها نمی‌بیند و کاربر A سودی می‌بیند که نکرده. تست `multi-user-isolation` این را نمی‌گیرد چون عمداً کد دوم را `4100_b` گذاشته (خط ۸۲).

### F-04 · High — نشت مانده در حساب‌های مشترک (`user_id IS NULL`) در ماژول حساب‌ها
`getAccountBalances` (`queries.ts:94-126`) مستأجر را روی **جدول حساب** فیلتر می‌کند و فهرست مجاز کدهای جهانی (`1000,1300,1400,1600,1610,1620,2000,3000,3010,3015,3200,4000,4010,4100,4900,5000,5010…5900`) را استثنا می‌کند، **اما `join postings` را به `je.user_id` محدود نمی‌کند** ⇒ جمع، بین‌کاربری است. ماژول ملک دقیقاً همین ردیف‌های جهانی را می‌سازد (`realEstate/service.ts:117-141`).
**شاهد:** کاربر ۱ (ملک ۱۰۰٬۰۰۰ دلار) و کاربر ۲ (ملک ۲۵۰٬۰۰۰ دلار) — هر دو در `/accounts`:
```
1600 املاک و مستغلات   qty=2  base=350000     ← باید 100000 و 250000 باشد
3015 سرمایه افتتاحیه   qty=−2 base=−350000
```
اثر جانبی: Metric «جمع کنترلی دفتر» و «ارزش پایه حساب‌های پول» در چند-مستأجری عدد مخلوط نشان می‌دهند.

### F-05 · Medium — کارمزد در بهای تمام‌شدهٔ لا هست، در ماندهٔ حساب دارایی نیست ⇒ باقیماندهٔ دائمی
`postEntry` لا را با `costBase = value + fee` باز می‌کند (`service.ts:854`) ولی ردیف دارایی فقط `+value` است. موقع فروش، حساب دارایی `−costBasis` (شامل کارمزد) می‌خورد.
**شاهد:** پس از تصفیهٔ کامل، حساب `MKT-ETH`: `qty=0` اما `base=-100`. چون ماژول دارایی‌ها بر اساس `Σ quantity` فیلتر می‌کند، ردیف ناپدید می‌شود و این `−100` در هیچ‌کدام از کارت‌های `/accounts` هم دیده نمی‌شود (بخش داراییِ «نمودار کامل حساب‌ها» فقط چهار نوع غیر از asset را نشان می‌دهد) ⇒ **ارزش خالص با جمع ماندهٔ دفترکل تسهیم نمی‌شود.**

### F-06 · Medium — «خرید» هیچ محافظ موجودی ندارد
`preventOverdraft` تنها در `service.ts` تعریف/منتقل می‌شود و در `src/**` **هیچ فراخوانی true نمی‌دهد**.
**شاهد:** با موجودی ۳۸۰٬۰۰۰٬۰۰۰ تومان، خرید ۵۷۰٬۰۰۰٬۰۰۰ تومانی Accepted و `1010 → base=−1000`. برای فروش محافظ FIFO هست، برای نقد نه.

### F-07 · Medium — حساب منفی در ماژول حساب‌ها «مثبت» نمایش داده می‌شود
`canonicalBalance` و `valuationToman` و `toIrt` صفحهٔ `/accounts` همگی `.abs()` می‌گیرند (خطوط ۶۲، ۸۷-۹۲، ۹۹، ۱۶۵). نتیجه: بیش‌برداشت/حساب منفی بدون هیچ رنگ یا هشدار قرمز، عیناً به‌شکل موجودی مثبت خوانده می‌شود. (در `/debts` برای بدهی رنگ قرمز عمدی است، اینجا نه.)

### F-08 · Medium — فروش‌های ماژول‌های RWA اصلاً به دفترکل نمی‌رسند
`sellVehicle` فقط `vehicle_assets` را به‌روز می‌کند (`vehicle/service.ts:311-339`)؛ `saveRwaAction`/طلا/کالا هم فقط `assets`+`ownership`+`valuation` (`app/actions/registry.ts:120-135`).
پیامد: وجه حاصل از فروش در هیچ حساب نقدی نمی‌نشیند، هیچ `4100` دریافت نمی‌کند، هیچ لا مصرف نمی‌شود — و فقط «سبد» تغییر می‌کند. برای ملک مسیر درست اجرا می‌شود (postEntry) ⇒ **ناهمواری بین ماژول‌های دارایی واقعی**.

### F-09 · Low — واحد بومی و «غبار اعشاری» در `quantity`
قیمت واحد IRT = `1 / rate` روی ۱۸ رقم اعشار بریده می‌شود ⇒ ۳۰۰۰ دلار ÷ ۰٫۰۰۰۰۰۵۲۶۳۱۵۷۸۹۴۷۳۶ = **۵۷۰٬۰۰۰٬۰۰۰٫۰۰۰۰۹۱۲** تومان. هیچ اثری روی `base_value` ندارد (تراز درست است) و در نمایش گرد می‌شود، اما ستون `quantity` هرگز عدد صحیح تومانی نیست.
همچنین ردیف کارمزد در **فروش**، `quantity = fee` را در واحد **دلار** روی حسابی با واحد بومی IRT می‌نویسد (`service.ts:957-964`) ⇒ جمع `quantity` آن حساب واحد مخلوط می‌شود (شاهد: `+380٬000٬۰۰۰٫۰۰۰۰۶۰۸` و `−100`).

### F-10 · Low — انتخاب حساب طرف‌مقابل هزینه: «اولین ردیف type=expense» بدون `order by`
`actions.ts:513-515` برای همهٔ هزینه‌ها `… where type='expense' limit 1` می‌گیرد ⇒ در یک DB تازه همهٔ هزینه‌ها روی `5010 (خوراک و خانه)` می‌نشینند (چون `5040` اصلاً نیست — F-02) و نتیجه به ترتیب فیزیکی دیتابیس وابسته/غیرقطعی است. دسته‌بندی واقعی در `journal_entries.category_id` است، اما CoA گمراه‌کننده می‌شود.

### F-11 · Low — «ارزش پایه حساب‌های پول» واقعاً «جمع همهٔ حساب‌های دارایی» است
فیلتر `moneyAccountsRaw` (خط ۱۰۴-۱۰۶) هر حساب `asset` با مقدار≠۰ را می‌گیرد ⇒ BTC/ETH/طلا هم در این متریک و هم در لیست کارت‌های «حساب‌های پول» شمرده/نمایش داده می‌شوند (تحت سرفصل «بدون کیف‌پول»). نام متریک با محتوا هم‌خوان نیست.

### F-12 · Low — «فروش» در جریان نقدی: خطِ مبهم
`inflow = Σ (−base_value روی حساب‌های income)` ⇒ فروش ۲٬۰۰۰ دلاری با سود ۴۰۰، در `/cash-flow` فقط **۴۰۰** ورودی نشان می‌دهد؛ با سود صفر هیچ خطی؛ با زیان، `inflow` منفی. رفتار برای ترازنامه درست است ولی برای «جریان نقدی» گمراه‌کننده است و هیچ توضیحی در UI ندارد.

### F-13 · Low — دو جای کوچکِ نگاری
* `reverseEntry` ردیف `entry_fx_snapshots` سندِ ابطال‌شده را پاک/بی‌اثر نمی‌کند (قابل مشاهده در `/transactions` به‌عنوان فریزِ یک سند_void_) و رویداد `reverse_entry` را بدون `userId` در `audit_log` می‌گذارد (`service.ts:370-383, 405-411`).
* `refreshAll()` (`actions.ts:207-228`) مسیرهای `/assets`, `/assets/financial`, `/asset-registry`, `/new` را revalidate **نمی‌کند**؛ چون همه `force-dynamic` هستند عملاً مشکل‌ساز نیست، اما اگر روزی static شوند، ماندهٔ دارایی‌ها کهنه می‌ماند.

### F-14 · Info — نکات ساختاری (بدون باگ)
* یک حساب کریپتو به‌ازای هر (asset, user) و **بدون `wallet_id`** ⇒ FIFO لاها سراسری بر اساس `asset_id` مصرف می‌شوند، نه به‌ تفکیک صرافی/کیف (`service.ts:310-330`)؛ اگر کاربر همان دارایی را در دو صرافی داشته باشد، امانت‌داری و P&L هر صرافی جدا نمی‌شود (این محدودیت در `docs/AUDIT-FINANCIAL-LOGIC-2026-08-21.md` از قبل مستند است).
* `resolveServiceUserId` در حالت تک‌کاربره `undefined` برمی‌گرداند ⇒ اسناد بی‌صاحب؛ در DB چند‌کاربره **401** (Fail-Closed) ✅.
* `i18n/` (۱۲۰ خط) در عمل بی‌مصرف است.

---

## ۱۳) حلقهٔ صحت‌سنجی موجود (چه چیزی خودکار نگهبانی می‌کند)

* `/audit` هفت آزمون زنده: تراز دفترکل · کامل‌بودن اسناد · سازگاری بهای تمام‌شده (`qty_opened − qty_remaining − Σ consumed = 0`) · پیوند اقساط با دفترکل · پوشش قیمت‌گذاری · رکورد تکراری · بازبینی درون‌ریزی‌ها (`features/integrity/service.ts:104-200`).
* نوار `/ledger`: شمارش زندهٔ اسناد نامتوازن (`ledger/page.tsx:41-56`).
* `integrityCheckAction` دکمهٔ دستی؛ `npm run db:check` تشخیص ریشه‌ای خطای اتصال.
* کوئری دستی پیشنهادی (باید ۰ سطر بدهد):
```sql
select je.id, sum(p.base_value) from journal_entries je
join postings p on p.entry_id = je.id
group by je.id having abs(sum(p.base_value)) > 1e-9;
```
**افق پوشش:** هیچ آزمون خودکاری برای «F-01/F-02/F-03/F-04» (تسهیم کارمزد، نبود `5040`، انتخاب حساب با `code` بدون فیلتر مستأجر، جمع بین‌کاربری در حساب مشترک) وجود ندارد — آزمون‌های موجود همه ترازِ **داخل یک سند** را می‌سنجند، نه تخصیصِ **درست** ردیف‌ها.

---

## ۱۴) توصیه‌ها (بدون اعمال؛ فقط اولویت‌بندی)

| اولویت | اقدام |
|---|---|
| P-01 | رفع F-01: در فروش، یا `netProceeds` روی نقد (بدون ردیف دوم `−fee`) یا `proceeds` + ردیف `−fee` — یکی، نه هر دو؛ سپس تسهیم دوبارهٔ `lot_consumptions.proceeds_base`. |
| P-02 | رفع F-02: افزودن `5040` (و `4900/5030/5050`) به نمودار حساب `completeSetup()` + یک `ensure*` lazy مثل `ensureReserveAccount(3200)`؛ و رفتار یکسان buy/sell وقتی حساب کارمزد نیست. |
| P-03 | رفع F-03: افزودن `user_id` (یا fallback صریح به ردیف جهانی) به هر lookup مبتنی بر `code` + `order by`. |
| P-04 | رفع F-04: فیلتر `je.user_id = ${u}` روی joinِ `postings` در `getAccountBalances` (و همسان‌سازی `getHoldings`)؛ یا ساخت حساب‌های ملک به‌ازای مستأجر. |
| P-05 | رفع F-05: کارمزد را در ردیف دارایی هم لحاظ کن (یا از `costBase` لا حذفش کن) تا پس از تصفیه، حساب دارایی دقیقاً صفر شود. |
| P-06 | F-06/F-07: فعال‌کردن `preventOverdraft: true` برای مسیر خرید/انتقال، و نمایش علامت منفی (بدون `.abs()`) با رنگ هشدار در `/accounts`. |
| P-07 | F-08: تصمیم محصول — یا فروش خودرو/طلا/کالا هم از `recordSell` عبور کند (یا لا مجازی)، یا UI صریح بگوید «این فروش در دفترکل ثبت نمی‌شود». |
| P-08 | F-09/F-10/F-11/F-12: اصلاح واحد `quantity` ردیف‌های غیربومی، تعیین حساب طرف‌مقابل هزینه با `order by code`/نگاشت دسته→حساب، تغییر نام متریک به «جمع حساب‌های دارایی»، و افزودن توضیح/خطِ جدا برای «وجه دریافتی از فروش» در جریان نقدی. |
| P-09 | افزودن ۴ آزمون رگرسیون برای F-01…F-04 و یک آزمون «تسهیم پس از تصفیهٔ کامل». |
| P-10 | تجمیع گزارش‌های ریشه در `docs/` (۴ فایل `*.md` در ریشه) و کاهش `createTransactionAction` (۴۲۳ خط) با استخراج هر نوع تراکنش به ماژول خودش. |

---

## ۱۵) آنچه این ممیزی **تأیید می‌کند که نشکسته است**

* تراز دوطرفه در ۶ سناریوی اجراشده: `control sum of all postings = 0.000000000000000000` ✅
* محافظ بیش‌فروش: `oversell REJECTED → موجودی دارایی برای فروش کافی نیست.` ✅ (با rollback کامل)
* FIFO: ترتیب بازگشتی `opened_at`، مصرف جزئی، ثبت `realized_pnl`، و `getRealizedPnl() = 400` برای مثال بالا ✅
* فریز نرخ: یک سند فروش، `entry_fx_snapshots` را در همان تراکنش نوشت؛ هیچ بازمحاسبه‌ای با نرخ بعدی انجام نمی‌شود ✅
* IRT کاننیکال: ماندهٔ تومان هرگز با نرخ فعلی بازنویسی نمی‌شود؛ فقط ارزش‌گذاری دلاری مشتق است ✅
* Idempotency، ابطال مشروط (`posted→void`)، Fail-Closed احراز هویت، حذف فیزیکی ممنوعِ دفترکل، archive شدن حساب‌های دارای سابقه ✅
* seed خودکار در production: خاموش ✅ / `memory://` در production: رد ✅

---

### پیوست — بازتولید شواهد
سه هارنس موقت (حذف‌شده) با `DATABASE_URL=memory:// npx tsx <file>` اجرا شدند و ردیف‌های `journal_entries/postings/lots/lot_consumptions` و خروجی `getAccountBalances`/`getHoldings`/`getRealizedPnl`/`getPortfolioValuation` را بعد از «خرید ۱ ETH»، «فروش ۰٫۵ ETH با کارمزد»، «خرید با کارمزد بدون حساب 5040»، «تلاش برای فروش بیش از موجودی»، «تصفیهٔ کامل» و «دو مستأجر با حساب مشترک» چاپ کردند. تمام اعداد به‌کاررفته در این گزارش، عیناً از همان خروجی‌ها هستند.
