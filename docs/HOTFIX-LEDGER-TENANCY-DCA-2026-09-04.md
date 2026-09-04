# گزارش اجرای Hotfix و Refactor — چنداجاره‌ای بودن دفتر کل، DCA چندارزی و جداسازی ماژول دارایی‌ها

**تاریخ:** ۱۴۰۵-۰۶-۱۳ (۲۰۲۶-۰۹-۰۴) · **اولویت:** Critical (B0) · **مبدأ:** `261264d`
**مستند مرجع:** `docs/AUDIT-BUY-SELL-ACCOUNTS-ASSETS-2026-09-04.md` (یافته‌های F-01…F-14)

> **قیدهای رعایت‌شده:** `src/domain` (هسته حسابداری)، `assertBalanced` (نابراوری Σ = ۰) و منطق
> مصرف FIFO (`consumeFifo`) **هیچ تغییری نکردند**. تمام تغییرات در لایه‌های
> `src/features/ledger`، `src/features/accounts`، `src/features/portfolio`،
> هندلرهای اکشن (`src/app/actions.ts`)، فیلترهای کوئری و مدل خوانش/نمایش است.

---

## ۱) جدول تغییرات در یک نگاه

| # | یافته | وضعیت | فایل / تابع |
|---|-------|--------|--------------|
| F-01 | کارمزد فروش دوبار اعمال می‌شد | ✅ اصلاح شد | `ledger/service.ts:940` `recordSell` (حذف جفت پست «۵۰۴۰ + کارمزد» و «نقد − کارمزد») |
| F-02 | نبود حساب ۵۰۴۰ در چارت راه‌اندازی → سند نابلد | ✅ اصلاح شد | `setup/service.ts` (کدهای ۴۹۰۰/۵۰۳۰/۵۰۴۰/۵۰۵۰) + `drizzle/0011_fee_expense_account.sql` + `ensureFeeExpenseAccount` |
| F-03 | جست‌وجوی حساب سیستمی با `code` بدون فیلتر tenant | ✅ اصلاح شد | `accounts/systemAccounts.ts` (ماژول تازه) ← `actions.ts:547,710,730,755`، `ledger/service.ts:recordBuy/recordSell` |
| F-04 | `getAccountBalances` بدون فیلتر tenant روی join پست‌ها | ✅ اصلاح شد | `ledger/queries.ts:113,135` (`je.user_id`) |
| F-05 | ماندهدار شدن حساب دارایی پس از فروش کامل | ✅ اصلاح شد | `ledger/service.ts:931` (`costBase = value` بدون کارمزد) |
| F-06 | استفاده از `.abs()` در مدل نمایش `/accounts` | ✅ حذف شد | `src/app/accounts/page.tsx` (۹ مورد؛ فقط آستانه صفرِ «جمع کنترلی» باقی ماند) |
| F-07 | اعتبارسنجی Overdraft فقط سمت کلاینت | ✅ سمت سرور | `actions.ts:713,733,774` (`preventOverdraft: true` برای buy/transfer/fx) + `ledger/service.ts:216` (کوئری اسکوپ‌شده به tenant) |
| F-08 | تسویه دارایی خارج از مسیر یکپارچه سند | ✅ مسیر یکپارچه ساخته و وصل شد | `ledger/service.ts:1099` `recordRegistryDisposal` ← `rwa/vehicle/service.ts` `sellVehicle` + فیلد اختیاری «واریز به حساب» |
| R-1 | جداسازی Liquid از Investment | ✅ | `accounts/classification.ts` (ماژول تازه) ← `/accounts`، `TransactionForm`، `/new`، `getAccountBalances` |
| R-2 | موتور DCA و ارزش‌گذاری چندارزی | ✅ | `portfolio/dca.ts` (ماژول تازه) ← `portfolio/types.ts`، `portfolio/service.ts`، `HoldingsTable.tsx` |
| R-3 | پرداخت خرید از بانک ریالی **و** کیف‌پول USDT | ✅ | `feeMode` در `txSchema` + `primaryOptions/counterOptions` در فرم تراکنش |

آزمون‌های تازه: `tests/hotfix-ledger-tenancy-fees.test.ts` — **۹ سنجه، همه سبز**؛ هر سنجه یک عدد را
قفل می‌کند که کد قبلی غلط می‌داد.

---

## ۲) F-01 و F-05 — کارمزد، یک‌بار و نه بیشتر

سند **خرید** (تغییرناپذیر در ساختار، فقط پایه ارزش‌گذاری اصلاح شد):

```
حساب دارایی   +value            ← دقیقاً همان چیزی که lot به عنوان بهای تمام‌شده ثبت می‌کند
حساب نقد      −(value + fee)     ← کل پولی که واقعاً از جیب خارج شد
۵۰۴۰ کارمزد    +fee              ← هزینه؛ هرگز به بهای دارایی اضافه نمی‌شود
Σ = 0  ✓        lot.unitCostBase = value ÷ qty
```

سند **فروش** (حذف اعمال دوباره):

```
حساب دارایی   −costBasis(FIFO)
حساب نقد      +(gross − fee)     ← «جریان نقدی خالص = کل دریافت منهای کارمزد» ✓
۴۱۰۰ سود       −((gross − fee) − costBasis)   ← فرمول خواسته‌شده، عیناً
Σ = 0  ✓
```

**نتیجه عددی — سناریوی دقیق `tests/hotfix-ledger-tenancy-fees.test.ts`:
خرید ۰٫۵ اتریوم به ۱۰۰۰ دلار با کارمزد ۱۰ دلار، سپس فروش کامل به ۲۰۰۰ دلار با کارمزد ۱۰۰ دلار:**

| سنجه | قبل (باگ) | بعد |
|------|-----------|-----|
| مانده بانک پس از خرید | `−۱۰۱۰` | `−۱۰۱۰` (بدون تغییر — درست بود) |
| `lot.unitCostBase` | `۲۰۲۰` (۱۰۱۰ ÷ ۰٫۵ — کارمزد سرمایه‌ای شد) | **`۲۰۰۰`** (۱۰۰۰ ÷ ۰٫۵) |
| واریز خالص فروش به بانک | `+۱۸۰۰` (کارمزد دوبار کسر شد) | **`+۱۹۰۰` = ۲۰۰۰ − ۱۰۰** |
| سود تحقق‌یافته (۴۱۰۰) | `۸۹۰` روی بهای اشتباه | **`۹۰۰` = (۲۰۰۰ − ۱۰۰) − ۱۰۰۰** |
| مانده حساب دارایی پس از خروج کامل | `−۱۰`/`−۰٫۰۰۵` شبح کارمزد | **`۰` دقیقاً (هم ارزی هم مقداری)** |
| `lot_consumptions.proceeds_base` در برابر وجه نقد واقعی | ناهماهنگ | **هماهنگ — هر دو خالص** |
| Σ تمام پست‌های دیتابیس | ۰ | **۰** |

توضیح تصمیم (بخش ۱۲، مورد باز ۲): کاربر گرامی، فرمول `Realized = (Proceeds − Fee) − Cost` و
«ثبت کارمزد فروش به‌صورت بدهکار ۵۰۴۰» در یک سند دوطرفه **هم‌زمان ممکن نیست**؛ جمع دو پست
نقدی مجزا برای یک کارمزد، خودِ همان اعمال دوباره بود. مسیر انتخاب‌شده: کارمزد **خرید** به ۵۰۴۰
(هزینه، با دسته `INS-BANK-FEE`) و کارمزد **فروش** خالص‌سازی‌شده در سود تحقق‌یافته. مبلغ کارمزد فروش
از `entry_fx_snapshots` (ارزش کل) مندرج در سند و پست حساب نقد قابل بازیابی است و در memo هم ثبت
می‌شود: «واریز خالص وجه (کسر کارمزد …)».

**F-05:** چون پایه lot و پست حساب دارایی هر دو `value` شدند، فروش کاملِ یک موقعیت حساب را
دقیقاً به صفر می‌رساند (نه صفر منهای کارمزد) — این همان چیزی است که باعث می‌شد دارایی «هرگز
تمام نمی‌شد».

---

## ۳) F-02 و F-03 — حساب سیستمی، مالِ خودِ tenant

ماژول تازه `src/features/accounts/systemAccounts.ts` (برگ؛ فقط `db` و `schema` را import می‌کند تا
هیچ حلقه‌ای با `accounts/service.ts` یا `ledger/service.ts` ساخته نشود):

1. `resolveSystemAccount(code, userId)` → اول ردیف **خود کاربر**، سپس ردیف **مشترک/global**
   (`user_id IS NULL`)، به‌همراه `deleted_at is null` و `order by created_at` (حذف «limit 1 بی‌ترتیب»).
2. `resolveSystemAccountById(id, userId)` → شناسه‌ای که کاربر فرستاده فقط وقتی معتبر است که مال
   خودش یا یک ردیف global باشد؛ در غیر این صورت `null` برمی‌گردد و فراخوان **ساخت** می‌کند، نه
   استفاده از حساب دیگری.
3. `ensureSystemAccount / ensureFeeExpenseAccount / ensureRealizedPnlAccount` → ساخت idempotent با
   `onConflictDoNothing((user_id, code))` و دوباره‌خوانی (الگوی `ensureReserveAccount`).
4. `assertSystemAccount` → خطای فارسیِ روشن به‌جای «سند تراز نیست» (توقف **پیش از** هر نوشتن).

پوشش داده‌های موجود:

- `src/features/setup/service.ts` → چارت راه‌اندازی حالا ۴۹۰۰، ۵۰۳۰، **۵۰۴۰**، ۵۰۵۰ را هم دارد
  (هم‌راستا با `src/db/seed.ts`؛ قبلاً ۵۰۴۰ فقط در seed بود و نصب تازه آن را نداشت).
- `drizzle/0011_fee_expense_account.sql` (داده‌محور، بدون تغییر schema، idempotent):
  (الف) ردیف ۵۰۴۰ نرم‌حذف‌شده را **احیا** می‌کند، (ب) برای هر tenant که حساب دارد و ۵۰۴۰ ندارد
  می‌سازد، (پ) در دیتابیس تک‌کاربرده قدیمی یک ردیف global می‌سازد.
  همراه آن `drizzle/meta/_journal.json` (idx ۱۱) و `0011_snapshot.json` (کپی وضعیت schema —
  چون تغییری در schema نیست تا زنجیره `db:generate` نشکند).
  رفتار مهاجرت روی PGlite راستی‌آزمایی شد: ساخت به‌ازای هر tenant، اجرای مجدد = بدون تغییر،
  احیای ردیف حذف‌شده بدون تکرار، و fallback سراسری.

**تست‌ها:** `F-02 …` (ساخت خودکار ۵۰۴۰ و ثبت ۱۰ واحد هزینه) و
`F-03 …` (نام‌بردن از `pnlAccountId`/`feeAccountId` کاربر دیگر → ۴۱۰۰/۵۰۴۰ او **صفر** می‌ماند و
مبلغ در حساب خودِ tenant می‌نشیند).

---

## ۴) F-04 — مانده حساب‌های مشترک، به تفکیک کاربر

`getAccountBalances` تنها مسیر خوانشی بود که `journal_entries` را بدون فیلتر tenant می‌پیوست؛
بنابراین مانده یک حساب **مشترک** چارت (۵۰۴۰، ۴۱۰۰، ۱۶۰۰، ۱۰۰۰، …) جمع کل دیتابیس بود.

```sql
left join journal_entries je on je.id = p.entry_id
  and (je.user_id = ${u} or je.user_id is null)      -- ← افزوده شد
```

- join از نوع LEFT است؛ پس پست‌های مربوط به دیگر tenants با `je.* = null` می‌مانند و `case when
  je.status='posted'` آن‌ها را از جمع **خارج** می‌کند — بدون حذف ردیف حساب.
- `or je.user_id is null` رفتار `getHoldings` را نگه می‌دارد تا نصب‌های قدیمی (قبل از
  `npm run db:legacy-claim`) مانده‌شان صفر نشود.
- دو فیلد تازه در مدل خروجی برای طبقه‌بندی: `classCode` و `walletKind` (فقط نمایشی).

**تست:** `F-04 …` — دو کاربر روی **یک** ردیف global ۵۰۴۰؛ A فقط ۱۰ و B فقط ۲۵۰ را می‌بیند
(قبلاً هر دو ۲۶۰ می‌دیدند).

---

## ۵) F-06 و F-07 — نشاندن علامت و موجودی منفی

- هر ۹ `.abs()` مدل نمایش `/accounts` حذف شد: `toIrt`، `canonicalBalance`، `valuationToman`،
  جمع خالصِ irtOnly، `singleApprox`، `baseValueLabel`، بلوک بدهی‌ها و فهرست «نمودار کامل
  حساب‌ها». جایی که معنای مالی واژگونی دارد (حساب بدهی/درآمد/سرمایه credit و منفی ذخیره
  می‌شوند)، به‌جای `abs()` از **واژگونی علامت** استفاده شد؛ بنابراین یک بدهیِ تسویه‌شده‌ی
  بیش‌ازحد (debit) دیگر به‌صورت بدهی مثبتِ هم‌اندازه نمایش داده نمی‌شود.
  تنها `.abs()` باقی‌مانده، آستانه صفرِ «جمع کنترلی دفتر» است که عددی را به کاربر نشان نمی‌دهد.
- اعتبارسنجی Overdraft در `postEntry` فعال شد (فقط برای `buy`، `transfer`، `fx`) و کوئری آن حالا
  به pست‌های خود tenant (+ ردیف‌های بی‌صاحب قدیمی) محدود است تا موجودی یک کاربرِ دیگر، کسری
  موجودی را نپوشاند. **فروش عمداً آزاد است**: محافظت فروش، همان guard موجودی FIFO است؛ فعال
  کردن این چک روی فروش باعث می‌شد داده‌های قدیمی (مانده‌های شبح F-05) مانده‌ی منفی داشته باشند و
  کاربرِ درست‌کار از تسویه دارایی‌اش blocker بگیرد.

**تست:** `F-07 …` — خرید بیشتر از موجودی → `INSUFFICIENT_BALANCE` و **هیچ** سندی ننوشت
(تعداد `journal_entries` بعد از rollback = ۱ = همان موجودی افتتاحیه).

---

## ۶) R-1 — جداسازی «حساب نقد» از «دارایی سرمایه‌گذاری»

`src/features/accounts/classification.ts` یک ماژول **خالص** است (بدون db، بدون Next) تا هم سمت
سرور و هم در کامپوننت کلاینت قابل import باشد. اولویت تطبیق: `symbol` → `asset_classes.code` →
نام کلاس → در نبود هر نشانه‌ای، «حساب نقد» فقط اگر در ظرف پولی باشد (`wallets.kind ∈
{bank, cash, fund}`)؛ در غیر این صورت **investment** (یک دارایی دسته‌بندی‌نشده هرگز «پول» فرض
نمی‌شود، ولی از بخش دارایی‌ها هم حذف نمی‌شود).

| Liquid (فقط `/accounts` + منبع/مقصود هزینه و درآمد) | Investment (فقط `/assets`، `/portfolio`، buy/sell/transfer) |
|---|---|
| بانک ریال، صندوق نقد، حساب ارزی | رمزارز نوسانی (BTC/ETH/SOL…) |
| کیف‌پول hot/cold استیبل (USDT/USDC/…) | سهام و صندوق، طلا و کالا |
| — | ملک، خودرو، RWA |

وصل‌شده به: مدل خوانش `/accounts` (فیلتر + تغییر عنوان به «حساب‌های نقد» و لینک به
«دارایی‌ها و سرمایه‌گذاری»)، `TransactionForm` (فقط‌سازِ گزینه‌ها برای expense/income/
debt_repayment و سمت پرداختِ buy/sell؛ `transfer` همان‌طور که باید آزاد است)، و `/new` که حالا
`classCode`/`className`/`walletKind` را هم به فرم می‌دهد. اگر کاربر هیچ حساب نقدی نداشته باشد،
فرم به‌جای فهرست خالی، راهنمای «افزودن حساب نقد» را نشان می‌دهد.

**تست:** `F-11 …` — ۱۵ حالت واقعی شامل «ارز نامشخص در بانک = نقد» و «کوین روی صرافی = دارایی».

---

## ۷) R-2 — موتور DCA و ارزش‌گذاری چندارزی

`src/features/portfolio/dca.ts` میانگین قیمت تمام‌شده را از `lots ⋈ entry_fx_snapshots` می‌سازد —
**همیشه با نرخ فریزشده در روزِ خرید، نه نرخ امروز**:

```
TotalCost(USD)  = Σ qty × unit_cost_base
TotalCost(IRT)  = Σ qty × unit_cost_base × FX_Rate_At_Tx
DCA_Unit(USD)   = TotalCost(USD) ÷ Σ qty
DCA_Unit(IRT)   = TotalCost(IRT) ÷ Σ qty
Unrealized(IRT) = market(IRT) − TotalCost(IRT)
```

- دو مجموعه عدد: **maintained position** (`quantityHeld`/`totalCost*`) و **تاریخچه کل**
  (`quantityBought`/`totalInvested*`) که با فروش کوچک‌تر نمی‌شود.
- `hasEstimatedFx` + `fallbackFxRate`: هر lot که snapshot نرخ ندارد با نرخ امروز تبدیل و **برآورد**
  برچسب می‌خورد؛ هرگز به‌جای عدد تاریخی جا نمی‌زند.
- `paySymbol` (نرخ‌گذاری‌شده با join روی بزرگ‌ترین پست منفیِ همان سند) مشخص می‌کند پرداخت با
  **تومان** بوده یا **دلار/تتر** → `tomanDenominatedQuantity`/`usdDenominatedQuantity` و
  `isTomanAnchored()`.
- `AssetValuation.valuationBase: "toman" | "usd"` قاعده لنگر را در مدل خوانش ثبت می‌کند:
  ملک/خودرو/نقد ریالی → **تومان ثابت، دلار = تومان ÷ نرخ**؛ قیمت بازار (CoinGecko) → **دلار
  ثابت، تومان = دلار × نرخ**. `HoldingsTable` آن را به‌صورت چیپ «مبنای تومان/مبنای دلار» و ستون
  «میانگین قیمت خرید» نمایش می‌دهد؛ `PortfolioSummary.totalInvestedUsd/Toman` هم افزوده شد.
- همه فیلدهای تازه **اختیاری**‌اند تا آزمون‌ها و ساخت‌های دستیِ موجود (`holdings-zero-tone`)
  نشکنند؛ و هیچ‌کدام در `costBasis`، `unrealizedPnl*` یا تدریجی جمع‌های کل دخالت نمی‌کند —
  DCA توضیح‌دهنده است، نه جایگزین.

**تست:** `DCA …` — خرید ۰٫۵ با ۹۵۰ دلار (نرخ ۱۹۰٬۰۰۰) و ۰٫۵ با ۱٬۲۵۰ دلار (نرخ ۲۵۰٬۰۰۰):
هزینه تومانی `۴۹۳٬۰۰۰٬۰۰۰` (نه `۲۲۰۰ × نرخ امروز`)، میانگین واحد `۲٬۲۰۰ دلار / ۴۹۳٬۰۰۰٬۰۰۰
تومان`، و پس از فروش نصف: `quantityBought` و `totalInvested` ثابت، `totalCost` به lot باقی‌مانده
(۱٬۲۵۰) می‌رسد.

---

## ۸) پرداخت چندواحدی (چک‌لیست بند ۳)

فیلد تازه `feeMode: "irt" | "native"` در `txSchema`: کارمزد در حالت `native` به **واحد خودِ حساب
پرداخت‌کننده** خوانده می‌شود و با همان `nativeUnitPriceUsd` (تنها مرجع نرخ واحد) به دلار تبدیل
می‌شود. برای بانک ریالی رفتار قبلی دست‌نخورده می‌ماند (واحد بومی = تومان)، ولی برای کیف‌پول
USDT دیگر «۵ تتر» برابر «۵ تومان» ثبت نمی‌شود. فرم تراکنش هم برچسب و واحد فیلد کارمزد را با
واحد حساب پرداخت‌کننده تنظیم می‌کند.
سمت پرداخت خرید/فروش حالا فقط حساب‌های نقد مجازند: بانک ریالی و کیف‌پول‌های USDT/USDC (و حساب
دلاری) — همان چیزی که چک‌لیست خواسته بود، به‌همراه گارد موجودی که اجازه نمی‌دهد کیف‌پول منفی شود.

---

## ۹) F-08 — تسویه دارایی از مسیر یکپارچه

`recordRegistryDisposal` در `ledger/service.ts`: همان `postEntry` (بنابراین همان assertBalanced،
همان idempotency، همان ردیف‌های audit)، همان انجماد `entry_fx_snapshots` و همان منطق حساب
سیستمیِ tenant‌اسکوپ؛ **بدون** `openLot`/`closeLot` — یک دارایی ثبت‌شده در registry تاریخچه FIFO
ندارد و دفتر کل نباید برای آن تاریخچه بسازد.

- اگر دارایی در دفتر **بهای ثبت‌شده** داشته باشد (حساب داراییِ همان asset):
  `دارایی −carrying`، `نقد +(gross−fee)`، `۴۱۰۰ −(net − carrying)`.
- اگر نداشته باشد (حالت فعلی خودروها): `نقد +net` و `۳۰۱۰ −net` — یعنی **ساخته‌شدن سود جعلی
  ممنوع**؛ ارزش خالص به اندازه پولی که واقعاً آمده بالا می‌رود و صورت سود/زیام آلوده نمی‌شود.
- `sellVehicle` حالا `saleAccountId` اختیاری می‌پذیرد: اگر انتخاب شود، سند فروش در **همان**
  تراکنش دیتابیسی با تغییر status نوشته می‌شید و در غیر این صورت رفتار قبلی (شناسنامه‌ای) حفظ
  می‌شود. مسیر UI (`/asset-registry` → VehicleModule → VehicleCard) فهرست حساب‌های نقد را از
  `getAccountBalances` filter شده با `isLiquidAccount` دریافت می‌کند.
- آزمون `F-08 …` سه چیز را قفل می‌کند: تراز بودن سند، **idempotent replay** (کلید
  `vehicle-sale:<id>` → همان `entry.id` و بدون واریز دوباره) و اینکه هیچ lot ساخته/مصرف نشده است.

---

## ۱۰) وضعیت نهایی — راستی‌آزمایی

| بررسی | نتیجه |
|--------|--------|
| `npx tsc --noEmit` | ۰ خطا |
| `npx eslint .` | ۰ خطا، ۱ اخطار (از قبل موجود در `src/app/setup/page.tsx`) |
| `npx next build` | موفق (تمام ۳۵ مسیر ساخته شد) |
| `tests/hotfix-ledger-tenancy-fees.test.ts` | ۹/۹ سبز |
| کل پوشه `tests/` (۶۶ فایل، PGlite) | تمام آزمون‌های مربوط سبز؛ **۱۹ شکست از قبل موجود** در ۶ فایل که روی commit پایه (`git stash`) **دقیقاً** همان‌طور تکرار می‌شوند: انتظارات workaround کاراکترهای bidi در `money-display`/`global-system-directive`/`e2e-smoke`/`landing-pwa`، `vehicle-module` (insert assets)، `real-estate-valuation-history` و `stage6` (listBudgets). هیچ‌کدام با این تغییرات ارتباط ندارند. |

دسته‌های اجراشده و سبز: `security-accounting-invariant`, `fifo-reversal`, `accounts-page-render`,
`portfolio-valuation`, `valuation-toman-consistency`, `holdings-zero-tone`,
`net-worth-snapshot-isolation`, `multi-user-isolation`, `security-isolation-hardening`,
`final-security-remediation`, `setup-wizard`, `stage5-full-regression-verification`,
`comprehensive-spec`, `currency-isolation-fix`, `money-account-registration`,
`opening-balance-display`, `real-estate-module`, `real-estate-actions.smoke`,
`accounts-code-unique-constraint`, `pro-mode-ledger-render`, `wealth-health-return-fix`,
`db-integration`, `account-denomination-fx`, `analytics-*`, `expense-categories`, `stage3`,
`stage4`, `stage7`, `rsc-serializable-props`, `supported-crypto-assets`, `market-removal`,
`security-remediation`, `security-backup-restore`, `security-fail-closed`,
`setup-aborted-transaction`, `login-gated-app`, `installment-*`, `debt-*`, `cash-flow-*`,
`fx-architecture`, `liquidity-forecast-*`, `reports-forward-*`, `price-resilience`,
`coingecko-catalog`, `current-pricing`, `asset-logo-resolution`, `number-to-words`,
`obligations-90day-scope`, `production-hardening`, `security-google-oauth`.

---

## ۱۱) راهنمای بازبینی دستی

1. `npm run db:migrate` → اجرای `0011_fee_expense_account.sql`. در `psql`:
   `select code, name, type, coalesce(user_id::text,'GLOBAL') from accounts where code='5040';`
   باید به‌ازای هر کاربری که حساب دارد یک ردیف بدهد.
2. یک خرید با کارمزد بسازید (مثلاً ۰٫۵ اتریوم، ۱۰۰۰ دلار، کارمزد ۱۰ دلار) → در `/accounts`
   مانده بانک `−۱۰۱۰` و ۵۰۴۰ برابر `+۱۰`.
3. همان موقعیت را کامل بفروشید (۲۰۰۰ با کارمزد ۱۰۰) → بانک `+۸۹۰`، حساب دارایی **دقیقاً ۰**،
   سود تحقق‌یافته در `/reports` برابر `۹۰۰` (اگر پایه ۱۰۰۰ بوده باشد).
4. `/accounts` را باز کنید: هیچ ردیف BTC/ETH/طلا/ملک/خودرو نباید بماند؛ فقط بانک، صندوق و
   کیف‌پول‌های استیبل. در `/portfolio → HoldingsTable` ستون «میانگین قیمت خرید» و چیپ
   «مبنای تومان/مبنای دلار» ظاهر شده است.
5. در `/new?type=expense` فهرست «پرداخت از حساب» دیگر حساب سرمایه‌گذاری ندارد؛ اگر حساب نقدی
   نباشد، لینک «افزودن حساب نقد» نمایش داده می‌شود.
6. برای دو کاربر متفاوت: مانده یک حساب مشترک (مثلاً همان ۵۰۴۰ global) در `/accounts` باید به‌ازای
   هر کاربر جداگانه و فقط سهم خودش باشد.

---

## ۱۲) موارد باز (پیشنهاد برای بک‌لاگ — عمداً در این hotfix انجام نشد)

1. **املاک مسیر «فروش» ندارند:** `createRealEstateAsset` یک سند `opening` می‌نویسد ولی هیچ
   `sellRealEstate` در ماژول وجود ندارد؛ حذف ملک (`deleteRealEstateAsset`) هم با آگاهانه فقط
   soft-delete می‌کند و سند را تغییر نمی‌دهد. `recordRegistryDisposal` برای این مسیر هم آماده است؛
   وصل‌کردنش نیازمند فیلد «واریز به حساب» در فرم املاک است (تغییر UI خارج از دامنه این hotfix).
2. **کارمزد فروش در گزارش هزینه‌ها دیده نمی‌شود** — به‌ایجاب فرمول بند F-01 (بخش ۲). اگر
   ترجیح می‌دهید کارمزد فروش هم در `INS-BANK-FEE` بیاید، باید `Realized = gross − cost` شود و
   این عدد در `/reports` ۱۰۰ واحد بزرگ‌تر نشان داده می‌شود.
3. **`getHoldings` هنوز ردیف‌های `user_id IS NULL` قدیمی را نمی‌بیند** (فقط `getAccountBalances`
   سازگار شد) — راه‌حل از قبل وجود دارد: `npm run db:legacy-claim`.
4. **حساب‌های ۱۶۰۰/۳۰۱۵ املاک هنوز global ساخته می‌شوند** (نوشتنِ مشترک). خوانش‌ها با F-04
   جدا شده‌اند، ولی نوشتن در `ensureRealEstateLedgerAccounts` هنوز ردیف مشترک می‌سازد؛ تبدیلش به
   حساب per-tenant یک تغییر migration-دار است.
5. `lot`ها به ازای **دارایی** گروه‌بندی‌اند نه به‌ازای **حساب**؛ اگر یک کوین در دو کیف‌پول باشد،
   مصرف FIFO بین آن‌ها تقسیم می‌شود و صفر شدنِ «همان حساب» تضمین‌شده نیست (مستند در هدر
   `ledger/service.ts`؛ تغییرش منطق FIFO است و در این task ممنوع بود).
