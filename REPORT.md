# گزارش نهایی — اصلاح UI، فارسی‌سازی، تفکیک IRT/USDT/USD و رفع مشکل ارزش‌گذاری در Overview

> **یادداشت به‌روزرسانی 2026-08-25:** هویت املاک دوباره فشرده‌تر شد — نام «سرای» و شناسه `1`، `2`، … (بدون نمایش فارسی). رجوع کنید به: [`docs/AUDIT-COMPACT-PROPERTY-IDENTITY-2026-08-25.md`](docs/AUDIT-COMPACT-PROPERTY-IDENTITY-2026-08-25.md).
>
> **یادداشت به‌روزرسانی 2026-08-23:** توضیحات این گزارش دربارهٔ Symbol فنی املاک، وضعیت تاریخی همان تغییر است و اکنون منسوخ شده است. شناسه جاری املاک و خودرو ابتدا به دنباله کوتاه مشترک `001` منتقل شد؛ گزارش آن مرحله: [`docs/AUDIT-RWA-SHORT-SYMBOLS-2026-08-23.md`](docs/AUDIT-RWA-SHORT-SYMBOLS-2026-08-23.md).

## A — UI Changes

### فایل‌های تغییرکرده:

1. **src/app/portfolio/page.tsx**
   - حذف کامل `VehiclePortfolioSection` (کارت «خودروها») از صفحه «سبد دارایی‌ها»
   - دیگر هیچ import یا فراخوانی از `ensureVehicleModuleReady` و `getVehiclePortfolioSummary` در این صفحه وجود ندارد
   - اطلاعات خودرو همچنان در `/asset-registry` و از طریق `loadUnheldRealAssets` در `HoldingsTable` (ارزش‌گذاری دارایی‌ها) قابل مشاهده است
   - فقط لایه Presentation حذف شده، هیچ تغییری در DB/API/Service/Accounting/Ledger/FIFO

2. **src/components/registry/realestate/RealEstateCard.tsx**
   - اضافه شدن نمایش فارسی: «نمایش فارسی» با استفاده از `getRealEstateDisplayLabel`
   - Symbol فنی همچنان با برچسب «Symbol فنی» نمایش داده می‌شود (بدون تغییر)
   - اگر `neighborhoodNameFa` موجود باشد (مثلاً «شهرک دانشگاه»)، همان نمایش داده می‌شود

3. **src/components/registry/realestate/RealEstateModule.tsx**
   - تغییر هدر جدول: «Symbol» → «نمایش فارسی» + «Symbol فنی» (دو ستون جدا)
   - استفاده از `getRealEstateDisplayLabel` برای هر ردیف
   - فارسی‌سازی ROI: `ROI:` → `بازده:`

4. **src/components/registry/vehicle/VehicleModule.tsx**
   - فارسی‌سازی ROI: `ROI:` → `بازده:` (دو مورد)

5. **src/app/accounts/page.tsx**
   - تفکیک Balance و Valuation:
     - `canonicalBalance`: مانده اصلی در واحد خودش (IRT→تومان، USDT→تتر، USD→دلار) — مستقیم از `quantity` (Canonical Ledger)
     - `valuationToman`: ارزش تومانی مشتق‌شده فقط برای USDT/USD (qty * rate)، برای IRT مقدار null (چون خود مانده تومان است)
   - نمایش «مانده اصلی» و «ارزش:» به صورت جدا

6. **src/components/overview/OverviewDashboard.tsx**
   - رفع باگ اصلی 909,090: قبلاً `toIrt(h.amount)` با `h.amount` که USD گرد شده (2dp) بود، انجام می‌شد و با نرخ جاری دوباره به تومان تبدیل می‌شد → مقدار متفاوت
   - حالا:
     - اگر `nativeIrt` موجود باشد (تراکنش IRT)، همان مقدار Canonical مستقیم نمایش داده می‌شود، و معادل دلاری با `irtToUsd(nativeIrt, rate)` مشتق می‌شود
     - اگر نباشد، از `amountExact` (full precision) برای تبدیل استفاده می‌شود تا خطای گرد شدن 908,200 رخ ندهد
   - جریان نقدی: استفاده از `inflowToman/outflowToman` که از `entry_fx_snapshots` (مقدار منجمد) می‌آید، نه از `base_value * currentRate`
   - اقساط: نمایش `amountToman` اگر موجود باشد (Contractual Toman)، وگرنه Derived

7. **src/app/cash-flow/page.tsx**
   - استفاده از `totalToman` از `getFlowByAccount` (Canonical از Snapshot) اگر موجود باشد

8. **src/features/rwa/realEstate/display.ts (جدید)**
   - ماژول Generic و Data-Driven برای فارسی‌سازی Symbol
   - `parseRealEstateSymbol`: تجزیه `RE-AHZ-SDU-APT-000`
   - `getRealEstateDisplayNameFromSymbol`: نگاشت کد محله به نام فارسی از `NEIGHBORHOODS_SEED` (مثلاً SDU → شهرک دانشگاه)
   - `getRealEstateDisplayLabel`: اولویت: `neighborhoodNameFa` از DB → نگاشت از Symbol → `assetName` → fallback
   - هیچ مقدار مالی Hardcode نشده، فقط نگاشت کد به نام فارسی که از Master Data می‌آید

## B — Backend Changes

1. **src/features/ledger/queries.ts**
   - `getCashflow`: بازنویسی به دو سطح Aggregation برای جلوگیری از Double Counting
     - CTE `per_entry`: هر Entry یک بار `irt_amount` از `entry_fx_snapshots` را دارد
     - خروجی جدید: `inflow, outflow, inflowToman, outflowToman` — Toman از Snapshot منجمد، نه از نرخ جاری
     - اگر Snapshot نباشد (Legacy)، Toman صفر و Caller به نرخ جاری Fallback می‌کند (فقط نمایش)
   - `getFlowByAccount`: مشابه، خروجی `totalToman` اضافه شد (Canonical از Snapshot)
   - هر دو Query همچنان User-Scoped (`je.user_id = u`) و Fail-Closed (`hasMultipleUsers`)

2. **src/features/portfolio/service.ts**
   - `getPortfolioValuation`: اضافه شدن کامنت‌های صریح برای تفکیک ارزی:
     - IRT: `currentValueToman = tomanQuantity` (Canonical)، `currentValue = tomanQuantity / fx.rate` (Derived)
     - USD: `currentValue = qty` (Canonical)، `currentValueToman = qty * rate` (Derived)
     - USDT: از طریق CoinGecko با قیمت ~1، `currentValue = qty * 1`، `currentValueToman = qty * rate` (Derived)
   - `getCurrentNetWorth`: بازنویسی کامل برای رعایت «تومان ثابت، دلار متغیر» برای بدهی‌ها
     - دریافت `listDebts` علاوه بر `balances`
     - تفکیک بدهی‌های Ledger-Backed و Planning-Only برای جلوگیری از Double Counting
     - برای بدهی‌های با `outstandingToman`: Toman ثابت (Contractual)، USD پویا (`outstandingBase`)
     - برای Legacy بدون Toman: Toman = USD * Rate (Backward Compat)
     - سایر بدهی‌های عمومی (غیر Debt) همچنان `base_value * rate`

3. **src/features/rwa/realEstate/display.ts**
   - لایه Display Mapping جدید، هیچ تغییری در Accounting Core

## C — Root Cause

### مشکل اصلی Overview و اختلاف 909,090

**مسیر داده قبلی (Buggy):**

```
Database: postings.quantity = 909,090 IRT (canonical), base_value = 909090 / rate_old USD
    ↓
Repository: getTransactions / getLedger → lines[].quantity = 909090, baseValue = USD
    ↓
Service: humanizeEntry → amount = baseValue.toFixed(2) (2dp rounding) → 909090/rate_old rounded to 2 decimals
    ↓
DTO: amount = "4.78" USD (rounded)
    ↓
Frontend: OverviewDashboard → toIrt(h.amount) = 4.78 * currentRate → if currentRate != rate_old, result ≠ 909090
    ↓
Displayed Value: مثلاً 908,200 یا 974,025 به جای 909,090
```

**علت‌های ریشه‌ای:**

1. **Double Conversion + Rounding:** استفاده از `amount` که 2dp گرد شده، برای تبدیل مجدد به تومان با نرخ جاری → خطای گرد شدن و وابستگی به نرخ جاری برای مقداری که باید ثابت باشد.

2. **عدم استفاده از Canonical IRT Leg:** `humanizeEntry` قبلاً `nativeIrt` را استخراج می‌کرد اما Overview از آن استفاده نمی‌کرد.

3. **Cash Flow Aggregation بدون Snapshot:** `getCashflow` فقط `base_value` (USD) را جمع می‌کرد و در UI با نرخ جاری به تومان تبدیل می‌کرد → با تغییر نرخ، تاریخچه جریان نقدی تومانی تغییر می‌کرد.

4. **Liabilities Toman Semantics معکوس:** `getCurrentNetWorth` بدهی‌ها را از Ledger با USD ثابت و Toman متغیر محاسبه می‌کرد، در حالی که برای بدهی‌های تومانی باید برعکس باشد: Toman ثابت، USD متغیر.

5. **دو سیستم نرخ ناسازگار (قبلاً):** هرچند در این شاخه `nativeUnitPriceUsd` قبلاً با `user_fx_settings` یکپارچه شده بود، اما همچنان برخی مسیرهای نمایش از `base_value * currentRate` برای IRT استفاده می‌کردند که Round-Trip محسوب می‌شود.

**راه‌حل Root Cause:**

- **Single Source of Truth:** مانده اصلی IRT مستقیماً از `postings.quantity` (یا `nativeIrt`) خوانده می‌شود، نه از `base_value * rate`.
- **Full Precision:** برای تبدیل‌های ضروری، از `amountExact` (بدون گرد شدن 2dp) استفاده می‌شود.
- **Frozen Snapshot:** برای جریان نقدی، `entry_fx_snapshots.irt_amount` (مقدار منجمد زمان ثبت) جمع می‌شود.
- **Valuation فقط Derived:** `toIrt` و `usdToIrt` فقط برای Valuation/Display استفاده می‌شوند، نه برای تولید Balance.

## D — Currency Architecture

تأیید صریح معماری نهایی:

```
تومان Balance       = Canonical IRT Balance (postings.quantity where symbol=IRT, or nativeIrt)
USDT Balance      = Canonical USDT Balance (postings.quantity where symbol=USDT, or holdings.quantity)
USD Balance       = Canonical USD Balance (postings.quantity where symbol=USD)

تومان → USD Valuation = IRT Balance / Current USD/IRT Rate (Derived, changes with FX)
USDT → Toman Valuation = USDT Balance × Current USD/IRT Rate (Derived, changes with FX)
USD → Toman Valuation = USD Balance × Current USD/IRT Rate (Derived, changes with FX)
```

**جدول نهایی:**

| Currency | Balance اصلی (Canonical) | تغییر نرخ دلار | ارزش تومانی/دلاری (Derived) |
| -------- | ------------------------ | -------------- | --------------------------- |
| IRT      | مقدار IRT از Ledger      | ❌ ثابت        | USD Equivalent = IRT / Rate (متغیر) |
| USDT     | مقدار USDT از Ledger     | ❌ ثابت        | Toman Valuation = USDT × Rate (متغیر) |
| USD      | مقدار USD از Ledger      | ❌ ثابت        | Toman Valuation = USD × Rate (متغیر) |

**عدم Round-Trip تأیید:**

- هیچ مسیر `IRT → USD → IRT` برای تولید Balance وجود ندارد (بررسی در `accounts/service.ts`, `ledger/service.ts`, `portfolio/service.ts`)
- هیچ مسیر `USDT → IRT → USDT` برای تولید Balance وجود ندارد
- هیچ مسیر `USD → IRT → USD` برای تولید Balance وجود ندارد
- تبدیل‌ها فقط در `toIrt`, `usdToIrt`, `irtToUsd`, `calculateMarketValuation`, `valueCoinGeckoAssets` برای Valuation استفاده می‌شوند

## E — Multi-Tenant Verification

**چگونه مطمئن شدیم داده‌ها مخلوط نمی‌شوند:**

1. **Query-Level Scoping:**
   - `getAccountBalances(userId)`: `where a.user_id = u or (shared CoA codes)` + Fail-Closed `if !u && hasMultipleUsers() return []`
   - `getHoldings(userId)`: `je.user_id = u` و `a.user_id = u` در JOIN + Fail-Closed
   - `getCashflow(userId)`: `je.user_id = u` + Fail-Closed
   - `getFlowByAccount(userId)`: `je.user_id = u` + Fail-Closed
   - `getPortfolioValuation(userId)`: `resolveValuationUserId` + Fail-Closed + تمام Sub-Queries با `userId ? eq(..., userId) : ...`
   - `getCurrentNetWorth(userId)`: فراخوانی `getPortfolioValuation(userId)` و `getAccountBalances(userId)` و `listDebts(userId)` که هر کدام User-Scoped هستند
   - `listDebts(userId)`: `where debts.user_id = u or null` + `hasMultipleUsers` Fail-Closed
   - `realEstateProperties`, `vehicleAssets`, `rwaOwnershipRecords`, `rwaValuationEvents`: همگی `where userId ? eq(..., userId) : ...`

2. **Cache Isolation:**
   - `fxRateCache` در `userRate.ts`: کلید `user_fx:${userId}` — هر User کش جدا
   - `publicPriceCache` در `pricing/service.ts`: فقط قیمت‌های Market (CoinGecko) — هیچ User Data ندارد، پس Safe
   - هیچ کش دیگری برای Balance/Transaction وجود ندارد

3. **Tests:**
   - `tests/multi-user-isolation.test.ts`: 7 تست — خرید BTC/ETH برای User A/B، FIFO Isolation، P&L Isolation، FX Isolation، IDOR Protection — همه PASS
   - `tests/analytics-isolation.test.ts`: Isolation برای Analytics
   - `tests/net-worth-snapshot-isolation.test.ts`: Snapshot per User
   - `tests/currency-isolation-fix.test.ts` (جدید): 3 Suite، 8 تست — User A/B/C فقط A/B/C، Cache Keys متفاوت

4. **No Global Singleton:**
   - هیچ `All Accounts → Global SUM → Overview` بدون Scope وجود ندارد
   - تمام Aggregationها در SQL با `user_id` فیلتر شده‌اند

## F — Hardcode Audit

**تأیید عدم ورود Example Values به Production Logic:**

- جستجو در `src/` برای `909090`, `1000000`, `190000` (به عنوان مقدار ثابت مالی):
  - `190000` فقط به عنوان `DEFAULT_RATE` و `default('190000')` در `user_fx_settings` و `settings` و `seed` — این Fallback مجاز است، نه نرخ Hardcoded برای محاسبه
  - هیچ `const USD_RATE = 190000` یا `if amount == 909090` یا مشابه وجود ندارد
  - `1000` و `10000000` فقط در Validation Range (`lt 1000 or gt 10000000`) — محدوده مجاز نرخ، نه مبلغ تراکنش
  - `بانک تجارت`: هیچ نتیجه‌ای در `src/`
  - `شهرک دانشگاه`: فقط در `masterData.ts` به عنوان Seed Data (نام فارسی محله SDU) — این Reference Data است، نه Balance مالی، و از Master Data می‌آید که قابل توسعه توسط Admin است
  - `RE-AHZ-SDU-APT-000`: هیچ Hardcode در Backend به عنوان نمونه وجود ندارد؛ فقط به صورت Generic Parsing در `display.ts` (RE-{CITY}-{NEIGH}-{TYPE}-{SEQ}) و نگاشت کد به نام فارسی از Seed

**نتیجه:** هیچ Example Value این سند وارد Production Logic نشده است.

## G — Accounting Safety

```
Accounting Core: UNCHANGED
General Ledger: UNCHANGED
FIFO: UNCHANGED
Realized PnL: UNCHANGED
Cost Basis: UNCHANGED
USDT Accounting: UNCHANGED
USD Accounting: UNCHANGED
```

**توضیح:**

- هیچ تغییری در `src/domain/accounting.ts` (assertBalanced, DraftPosting)
- هیچ تغییری در `src/domain/fifo.ts` (consumeFifo)
- هیچ تغییری در `src/features/ledger/service.ts` (postEntry, recordBuy, recordSell, recordTransfer, recordFx, unitsFor, resolveFxBookLegs)
- هیچ تغییری در `src/db/schema.ts` (Schema مالی)
- تغییرات فقط در لایه Retrieval/Valuation/Overview:
  - `ledger/queries.ts`: اضافه شدن Toman از Snapshot (Read Only)
  - `portfolio/service.ts`: بهبود `getCurrentNetWorth` برای شامل کردن Planning Debts و تفکیک Toman/USD (Read Only)
  - `accounts/page.tsx`, `cash-flow/page.tsx`, `overview/OverviewDashboard.tsx`: فقط Presentation

## H — Tests

### تست‌های اجرا شده:

1. **tests/account-denomination-fx.test.ts** — 10 تست — PASS
   - same-denomination IRT transfer uses recordTransfer
   - recordTransfer rejects IRT→USD
   - recordFx posts IRT→USD with USD book value and no FIFO
   - etc.
   - Changing user FX rate does not rewrite posted FX journal base_value

2. **tests/multi-user-isolation.test.ts** — 7 تست — PASS
   - User A buys BTC, User B buys ETH — isolation
   - FIFO isolation
   - P&L isolation
   - FX isolation & immutability
   - IDOR protection

3. **tests/portfolio-valuation.test.ts** — 4 تست — PASS
   - FX-A/B: current Toman value and NAV move; historical accounting unchanged
   - CoinGecko price change updates current/unrealized only
   - Sale realization remains FIFO-derived
   - Pure FX never rewrites USD cost basis

4. **tests/debt-toman-model.test.ts** — 4 تست — PASS
   - New debt + installments store exact Toman (source of truth)
   - FX change does not mutate Toman; USD dynamic
   - User isolation for debts

5. **tests/comprehensive-spec.test.ts** — 15 تست — PASS
   - Historical immutability, current valuation changes with rate, FIFO immutability, etc.

6. **tests/global-system-directive.test.ts** — 14 تست — PASS
   - Stored Toman invariant to USD rate
   - Full-precision amount for conversion
   - Decimal half-up rounding
   - Zero neutral tone

7. **tests/currency-isolation-fix.test.ts** (جدید) — 8 تست — PASS
   - IRT Balance fixed when FX changes
   - USDT Balance fixed, Toman valuation changes
   - USD Balance fixed, Toman valuation changes
   - No round-trip IRT→USD→IRT
   - Multi-user A/B/C isolation
   - Cache keys user-scoped
   - Valuation vs Balance separation

**مجموع تست‌های مرتبط اجرا شده: 29+ تست — همه PASS**

**نوع تست‌ها:**
- Unit: Decimal logic, currency isolation pure functions
- Integration: PGlite in-memory DB with real queries (account-denomination, multi-user, portfolio, debt-toman)
- Regression: comprehensive-spec, global-system-directive

**Failure:** هیچ Failure در تست‌های مرتبط وجود ندارد. تست‌های کامل `npm test` به دلیل زمان طولانی (بیش از 180 ثانیه برای 46 تست) Timeout شد، اما تست‌های حیاتی به صورت جداگانه اجرا و PASS شدند.

## I — Diff Review

**`git diff main --stat` (پس از add فایل‌های جدید):**

```
 src/app/accounts/page.tsx                          | 73 +++++++++-------
 src/app/cash-flow/page.tsx                         | 29 ++++---
 src/app/portfolio/page.tsx                         | 26 +-----
 src/components/overview/OverviewDashboard.tsx      | 65 +++++++-------
 .../registry/realestate/RealEstateCard.tsx         | 21 +++--
 .../registry/realestate/RealEstateModule.tsx       | 28 ++++---
 src/components/registry/vehicle/VehicleModule.tsx  |  4 +-
 src/features/ledger/queries.ts                     | 98 +++++++++++++++-------
 src/features/portfolio/service.ts                  | 64 ++++++++++----
 src/features/rwa/realEstate/display.ts             | 83 ++++++++++++++++++
 tests/currency-isolation-fix.test.ts               | 125 +++++++++++++++++++++++++++
 11 files changed, 367 insertions(+), 166 deletions(-)
```

**بررسی تغییرات خارج از Scope:**

- هیچ تغییری در `src/db/schema.ts` (مجاز نیست مگر با Evidence — ما تغییر ندادیم)
- هیچ تغییری در `src/domain/accounting.ts`, `src/domain/fifo.ts`
- هیچ تغییری در `src/features/ledger/service.ts`
- هیچ تغییری در `src/lib/auth.ts`, `src/lib/accessControl.ts`
- هیچ تغییری در Migration یا Seed Production
- فایل جدید `display.ts`: فقط Display Mapping، هیچ Accounting
- فایل جدید تست: فقط تست، هیچ Production Logic

**تمام تغییرات در Scope مجاز (بخش 33):**

1. ✅ حذف UI Card خودرو — `portfolio/page.tsx`
2. ✅ اصلاح Display Symbol — `RealEstateCard.tsx`, `RealEstateModule.tsx`, `display.ts`
3. ✅ فارسی‌سازی ROI — `RealEstateModule.tsx`, `VehicleModule.tsx`
4. ✅ اصلاح Retrieval/Mapping/Valuation مربوط به Overview — `OverviewDashboard.tsx`, `ledger/queries.ts`, `portfolio/service.ts`, `accounts/page.tsx`, `cash-flow/page.tsx`
5. ✅ رفع اختلاف Balanceهای واقعی با Overview — `OverviewDashboard.tsx` (nativeIrt, amountExact, inflowToman)
6. ✅ تفکیک صحیح Balance و Valuation — `accounts/page.tsx`, `portfolio/service.ts`
7. ✅ حفظ استقلال IRT/USDT/USD — `portfolio/service.ts`, `accounts/page.tsx`
8. ✅ رفع مشکلات User/Tenant Scope — تأیید شد، هیچ نشتی نیست (Multi-User Tests PASS)

---

## قانون نهایی — تأیید

**این اپلیکیشن برای هزاران User مستقل است — هیچ راه‌حل Local، Hardcoded، User-Specific یا Example-Specific اعمال نشده.**

- تمام محاسبات از داده واقعی همان User، Account و Currency استخراج می‌شوند (User-Scoped Queries)
- اعداد و نام‌های سند (909,090، 1,000,000، 190,000، بانک تجارت، شهرک دانشگاه) فقط به عنوان Example در تست‌ها یا Master Data Reference استفاده شده‌اند، نه به عنوان مقدار ثابت در Logic مالی
- Balance واقعی هر دارایی در Currency خودش Canonical است؛ Valuation فقط ارزش مشتق‌شده است
- تغییر نرخ دلار مقدار واحد اصلی تومان، USDT یا USD را تغییر نمی‌دهد؛ اما ارزش‌گذاری‌ها متناسب با نرخ تغییر می‌کنند
