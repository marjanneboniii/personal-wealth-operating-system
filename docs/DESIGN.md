# PWOS — Personal Wealth Operating System
## سند طراحی نرم‌افزار (Software Design Document) — نسخه ۱.۰

> این سند قبل از هر خط کد نوشته شده است. هر فاز پیش از ورود به فاز بعد تکمیل و با چک‌لیست بازبینی اجباری کنترل شده است.
> فلسفه محصول: **دفترکل تغییرناپذیر + محاسبه‌پذیری کامل + آرامش بصری**. سیستم «ابزار ثبت هزینه» نیست؛ «هسته مالی شخصی» است.

---

# فاز ۱ — معماری نرم‌افزار

## ۱.۱ تصمیم‌های کلان معماری (ADR خلاصه)

| # | تصمیم | گزینه‌های بررسی‌شده | انتخاب | دلیل |
|---|-------|--------------------|--------|------|
| ADR-1 | مدل داده مالی | ستون موجودی (mutable balance) / دفترکل دوطرفه | **دفترکل دوطرفه تغییرناپذیر** | موجودی مشتق‌شده = صفر احتمال ناسازگاری؛ قابلیت حسابرسی و بازسازی کامل تاریخچه |
| ADR-2 | چندارزی بودن | یک ارز پایه / چند ارز با تبدیل در گزارش | **Multi-asset postings + base_value** | هر پوستینگ هم «مقدار دارایی» و هم «ارزش در ارز پایه» دارد؛ تراز فقط روی base_value برقرار می‌شود |
| ADR-3 | حذف رکورد | Hard delete / Soft delete / Reversal | **ابطال با سند معکوس (Reversal) + Soft delete برای مرجع‌ها** | دفترکل هرگز پاک نمی‌شود؛ اشتباه با سند معکوس اصلاح می‌شود |
| ADR-4 | Enum ها | pg enum / جدول مرجع | **جدول مرجع** برای دارایی، ارز، شبکه، صرافی، بانک، کلاس دارایی | افزودن دارایی جدید نباید Migration بخواهد |
| ADR-5 | لایه‌بندی | MVC ساده / Clean Architecture | **Clean + Feature-based** | منطق حسابداری مستقل از Next.js و از Drizzle |
| ADR-6 | محاسبه اعداد | float / numeric + BigInt | **numeric(38,18) در DB + Decimal مبتنی بر BigInt در دامنه** | صفر خطای ممیز شناور در پول و کریپتو |
| ADR-7 | آینده‌نگری | ثبت آینده در دفترکل / موجودیت جدا | **Planned Transactions خارج از دفترکل** | برنامه تا اجرا نشود روی ثروت واقعی اثر ندارد (اصل صریح مسئله) |
| ADR-8 | هزینه دارایی | Average / FIFO | **FIFO با Lot Engine + گزارش میانگین** | مطابق استاندارد مالیاتی و شفاف برای سود تحقق‌یافته |
| ADR-9 | UI | SSR + جزایر کلاینت | **Server Components برای داده، Client فقط برای تعامل** | سرعت روی موبایل، پیلود کم |
| ADR-10 | حریم خصوصی | ابری / خودمیزبان | **Self-Hosted، بدون تله‌متری، بدون فراخوان شخص ثالث اجباری** | داده مالی خانواده هرگز خارج نمی‌شود |

## ۱.۲ معماری لایه‌ای (Clean Architecture)

```
┌──────────────────────────────────────────────────────────────┐
│ Presentation  (src/app/**)                                   │
│  Server Components، Route Handlers، صفحات، ناوبری، PWA       │
├──────────────────────────────────────────────────────────────┤
│ Application   (src/features/*/service.ts)                    │
│  Use-Caseها: RecordTransfer، BuyAsset، SellAsset، PayInstall  │
│  ExecutePlannedTx، TakeSnapshot، ProjectCashflow، Backup      │
├──────────────────────────────────────────────────────────────┤
│ Domain        (src/domain/**)                                │
│  Decimal، Money، Posting، JournalEntry، Lot، Balance،         │
│  NetWorth، DebtSchedule، Goal، Projection  (بدون I/O)         │
├──────────────────────────────────────────────────────────────┤
│ Infrastructure (src/db/**, src/lib/**)                       │
│  Drizzle، Postgres، Repositoryها، Price Provider، Backup IO   │
└──────────────────────────────────────────────────────────────┘
قانون وابستگی: پیکان‌ها فقط به سمت داخل. Domain هیچ import ای از Next/Drizzle ندارد.
```

## ۱.۳ ساختار پوشه‌ها

```
src/
  app/
    (shell)/                 layout موبایل‌اول + BottomNav + TopBar
      page.tsx               داشبورد
      portfolio/ ledger/ planning/ debts/ reports/ settings/ search/
    api/
      health/ dashboard/ transactions/ accounts/ assets/ prices/
      goals/ events/ planned/ debts/ installments/ funds/
      reports/{net-worth,allocation,pnl,cashflow,forecast}/
      snapshots/ backup/ restore/ seed/
  domain/
    decimal.ts               ریاضی دقیق BigInt
    money.ts                 فرمت واحدها و دقت اعشار هر دارایی
    accounting.ts            قواعد تراز، انواع سند، علامت حساب‌ها
    fifo.ts                  موتور Lot و سود تحقق‌یافته
    projection.ts            موتور پیش‌بینی جریان نقدی
  features/
    ledger/ portfolio/ planning/ debt/ reporting/ backup/
  db/ schema.ts index.ts seed.ts
  components/ ui/  charts/  layout/
  lib/ format.ts  http.ts  constants.ts
docs/DESIGN.md
```

## ۱.۴ نمودار وابستگی ماژول‌ها

```
                 ┌────────────┐
                 │  Reference │ (assets, currencies, networks, institutions)
                 └─────┬──────┘
                       ▼
   ┌──────────┐  ┌────────────┐   ┌──────────┐
   │ Wallets  │─▶│  Accounts  │◀──│  Funds   │
   └──────────┘  └─────┬──────┘   └──────────┘
                       ▼
             ┌───────────────────┐      ┌──────────┐
             │ Ledger (Journal + │─────▶│  Lots    │
             │      Postings)    │      └──────────┘
             └───┬───────────┬───┘
                 ▼           ▼
          ┌───────────┐  ┌──────────┐   ┌────────────┐
          │ Valuation │  │ Snapshot │◀──│  Prices    │
          └─────┬─────┘  └────┬─────┘   └────────────┘
                ▼             ▼
            ┌───────────────────────┐
            │  Reporting / Analytics│
            └───────────▲───────────┘
                        │
   ┌──────────┐  ┌──────┴──────┐  ┌──────────┐
   │  Debts   │─▶│  Planning   │◀─│  Goals   │
   │Installm. │  │ (planned tx,│  │ Events   │
   └──────────┘  │  budgets)   │  └──────────┘
                 └─────────────┘
Planning هرگز به Ledger نمی‌نویسد مگر از طریق Use-Case «اجرای برنامه».
```

## ۱.۵ Domain Driven Design

* **Bounded Contextها:** Accounting Core، Portfolio & Valuation، Liabilities، Planning، Reporting، Platform (کاربر/تنظیمات/پشتیبان).
* **Aggregate Rootها:** `JournalEntry` (با Postings)، `Account`، `Asset`، `Debt` (با Installments)، `Goal`، `Event`، `PlannedTransaction`، `Fund`، `Snapshot`.
* **Invariant سراسری:** یک `JournalEntry` فقط زمانی Post می‌شود که `Σ base_value == 0` و حداقل دو پوستینگ داشته باشد.
* **Domain Eventها:** `EntryPosted`، `PlanExecuted`، `InstallmentPaid`، `GoalFunded`، `SnapshotTaken` → مصرف‌کننده: Notifications، Snapshot، Audit.

## ۱.۶ جریان داده (نمونه: خرید BTC با USDT)
```
UI Form → POST /api/transactions (zod validate)
   → Application: BuyAssetUseCase
     → Domain: بساز دو پوستینگ (BTC +، USDT −) با base_value متقارن
     → Invariant: Σ base_value = 0  ✅
   → TX واحد Postgres: insert entry + postings + open lot (FIFO)
   → Domain Events → audit_log, notification
   → revalidate صفحات داشبورد/پرتفوی
```

## ۱.۷ امنیت
لاگین محلی با کد عبور (PIN) و کوکی امضاشده `HttpOnly/SameSite=Lax`؛ بدون ثبت‌نام عمومی؛ بدون ارسال داده به بیرون؛ Rate-limit روی مسیرهای نوشتن؛ اعتبارسنجی سرور با zod روی همه ورودی‌ها؛ Audit Log برای هر نوشتن؛ اصل کمترین دسترسی برای کاربر DB؛ آماده اجرا پشت شبکه خصوصی/VPN.

## ۱.۸ راهبرد پشتیبان‌گیری
۱) Export JSON کامل و قابل‌خواندن (همه جداول + نسخه اسکیما) از `/api/backup`.
۲) Restore تراکنشی و Idempotent با اعتبارسنجی نسخه از `/api/restore`.
۳) توصیه عملیاتی: `pg_dump` شبانه + نگهداری ۳-۲-۱ + آزمون بازیابی ماهانه.
۴) دفترکل تغییرناپذیر یعنی حتی Restore جزئی هم قابل تطبیق است.

### ✅ چک‌لیست بازبینی فاز ۱
ماژولار و قابل توسعه ✔ · وابستگی یک‌طرفه ✔ · قواعد حسابداری در هسته مستقل ✔ · سناریوهای ثروت پوشش داده شده ✔ · تصمیم‌ها مستند و دارای دلیل ✔ · آماده استفاده بلندمدت ✔

---

# فاز ۲ — طراحی پایگاه داده

## ۲.۱ نمودار ER (خلاصه متنی)

```
asset_classes 1─* assets *─1 networks
currencies 1─* assets                institutions 1─* wallets
wallets 1─* accounts *─1 assets      accounts *─1 accounts (parent)
journal_entries 1─* postings *─1 accounts
postings *─1 assets
lots *─1 accounts, assets ; lot_consumptions *─1 lots, journal_entries
prices *─1 assets
snapshots 1─* snapshot_lines
debts 1─* installments ; debts *─1 accounts(liability)
goals 1─* goal_contributions
events 1─* event_items
planned_transactions *─1 (goal|event|debt) اختیاری
budgets *─1 accounts(expense)
funds *─1 accounts   (emergency | reserve | family_support)
users 1─1 profiles ; settings ; notifications ; audit_log ; backup_runs
```

## ۲.۲ قواعد عمومی همه جداول
`id uuid pk default gen_random_uuid()` · `created_at timestamptz not null default now()` · `updated_at timestamptz` · `deleted_at timestamptz`(Soft Delete برای جداول مرجع/پیکربندی، **نه** برای دفترکل) · مقادیر پولی `numeric(38,18)` · تاریخ‌های مالی `date` و زمان‌ها `timestamptz`.

## ۲.۳ جداول کلیدی (هدف / ستون‌ها / قوانین)

**currencies** — ارزهای رسمی. `code(unique)، name، symbol، decimals، is_fiat`. قانون: `decimals ≥ 0`؛ حذف ارز درگیر در حساب ممنوع (فقط soft delete).

**asset_classes** — طبقه‌بندی: نقد، رمزارز، طلا، صندوق، سهام، املاک. `code، name، sort_order`.

**networks** — شبکه‌های بلاکچین: `code، name، chain_type`.

**institutions** — بانک/صرافی/کارگزار: `kind(bank|exchange|broker|other)، name، country`.

**assets** (Asset Master، جدا از Chart of Accounts) — `symbol، name، class_id، currency_id?، network_id?، decimals، price_source، is_active`. قانون: هر دارایی دقیقاً یک کلاس دارد؛ `decimals` تعیین‌کننده دقت نمایش/گرد کردن.

**wallets** — محل نگهداری: `name، kind(bank|exchange|hot|cold|cash|fund)، institution_id?، network_id?، address?`.

**accounts** (Chart of Accounts) — `code(unique)، name، type(asset|liability|equity|income|expense)، parent_id?، asset_id?، wallet_id?، is_active`. قوانین: حساب برگ‌دار (leaf) فقط پوستینگ می‌پذیرد؛ حساب از نوع asset با `asset_id` مشخص، تک‌دارایی است؛ درخت بدون دور.

**journal_entries** — سربرگ سند: `entry_date، type(transfer|buy|sell|income|expense|fx|fee|debt|installment|adjustment|opening)، description، reference، status(posted|void)، reversal_of?، source(manual|plan|import)، created_at`. قوانین: تغییرناپذیر؛ اصلاح فقط با سند معکوس.

**postings** — خطوط سند: `entry_id، account_id، asset_id، quantity numeric(38,18) signed، base_value numeric(38,18) signed، memo`. قوانین: `Σ base_value = 0` در هر سند؛ `quantity != 0`؛ علامت مثبت = افزایش منبع/ورود دارایی.

**lots** — بسته‌های FIFO: `account_id، asset_id، open_entry_id، opened_at، qty_opened، qty_remaining، unit_cost_base`. **lot_consumptions**: `lot_id، entry_id، qty، cost_base، proceeds_base، realized_pnl`.

**prices** — تاریخچه قیمت: `asset_id، as_of، price_base، source`. یکتا: `(asset_id, as_of)`.

**snapshots / snapshot_lines** — عکس لحظه‌ای ثروت: `as_of، base_currency، total_assets، total_liabilities، net_worth` + خطوط `asset_id، quantity، price_base، value_base`.

**goals / goal_contributions** — هدف مالی: `name، target_base، target_date، priority، status، fund_account_id?`.

**events / event_items** — رویداد (سفر، مراسم، هدیه): `name، event_date، category، budget_base، status`.

**budgets** — بودجه دوره‌ای: `period_start، period_end، account_id(expense)، amount_base`.

**debts** — بدهی: `creditor، principal_base، currency_id، interest_rate، start_date، account_id(liability)، status`. **installments**: `debt_id، seq، due_date، amount_base، status(pending|paid|late)، paid_entry_id?`. قانون: پرداخت قسط باید سند دوطرفه بسازد و وضعیت را به paid ببرد.

**obligations** — تعهدات مالی غیر اقساطی (اجاره، شهریه): `title، amount_base، due_date، recurrence، status`.

**funds** — صندوق‌ها: `name، kind(emergency|reserve|family_support)، target_base، account_id`.

**planned_transactions** — تراکنش برنامه‌ریزی‌شده: `title، planned_date، direction(inflow|outflow)، amount_base، from_account_id?، to_account_id?، asset_id?، recurrence(none|monthly|yearly)، status(pending|executed|cancelled)، executed_entry_id?، goal_id? event_id? debt_id?`. **قانون طلایی: تا `executed` نشود در هیچ محاسبه ثروت فعلی وارد نمی‌شود.**

**users / profiles / settings** — کاربر خانواده، ارز پایه، فرمت اعداد، تم، نرخ نمایش تومان.

**notifications / reminders / audit_log / backup_runs** — رویدادها، یادآور سررسید، ردپای تغییرات، فراداده پشتیبان.

## ۲.۴ نمایه‌ها (Indexes)
`postings(account_id, entry_id)` · `postings(asset_id)` · `journal_entries(entry_date desc)` · `prices(asset_id, as_of desc)` · `lots(account_id, asset_id, opened_at)` · `installments(due_date, status)` · `planned_transactions(planned_date, status)` · `snapshots(as_of desc)`.
دلیل: کوئری‌های داغ سیستم «مانده هر حساب»، «آخرین قیمت»، «سررسیدهای پیش‌رو» و «تایم‌لاین» هستند.

### ✅ چک‌لیست بازبینی فاز ۲
نرمال (3NF) ✔ · بدون ستون Balance ✔ · مرجع‌ها به جای Enum ✔ · محدودیت‌ها و ایندکس‌ها ✔ · Soft Delete فقط جای درست ✔

---

# فاز ۳ — مدل دامنه
* **Money/Decimal:** مقدار به‌صورت BigInt با ۱۸ رقم اعشار؛ جمع/تفریق/ضرب/تقسیم بدون خطای شناور.
* **JournalEntry (Aggregate Root):** چرخه عمر `draft → posted → (void via reversal)`. متد `post()` ابتدا `assertBalanced()` را اجرا می‌کند.
* **Account:** می‌داند نوعش چیست و علامت طبیعی‌اش کدام است؛ مانده = Σ postings.
* **Lot:** چرخه عمر `open → partially consumed → closed`؛ فروش، Lotها را به ترتیب `opened_at` مصرف می‌کند.
* **Debt:** تولید جدول اقساط، ثبت پرداخت، محاسبه مانده بدهی.
* **Goal:** پیشرفت = موجودی حساب صندوق ÷ هدف؛ تخمین تاریخ رسیدن از میانگین مشارکت‌ها.
* **PlannedTransaction:** `pending → executed(entry) | cancelled`؛ اجرا Idempotent است (اگر `executed_entry_id` پر باشد دوباره اجرا نمی‌شود).

# فاز ۴ — ماژول‌ها (مسئولیت / جریان / قواعد / وابستگی)
| ماژول | مسئولیت | قاعده کلیدی | وابستگی |
|---|---|---|---|
| داشبورد | خلاصه ثروت، تخصیص، سررسیدها | فقط داده مشتق‌شده | Valuation، Planning |
| پرتفوی | موجودی هر دارایی، سود تحقق‌نیافته | qty از دفترکل، value از آخرین قیمت | Ledger، Prices |
| دارایی‌ها/کیف‌پول‌ها/بانک‌ها/صرافی‌ها | مرجع‌ها و نگاشت به حساب | حذف نرم | Reference |
| دفترکل | مرور اسناد و پوستینگ‌ها | فقط خواندن + ابطال | Accounting |
| تراکنش‌ها | انتقال/خرید/فروش/درآمد/هزینه | تراز اجباری | Accounting، FIFO |
| ارزش خالص | Assets − Liabilities | لحظه‌ای + اسنپ‌شات | Valuation |
| تحلیل‌ها | روند، تخصیص، P&L | مبتنی بر snapshot و lots | Reporting |
| اهداف/برنامه‌ریزی/رویدادها/بودجه | آینده | خارج از دفترکل | Planning |
| بدهی/اقساط/تعهدات | بدهکاری‌ها | پرداخت = سند | Accounting |
| گزارش‌ها | ۱۶ گزارش فاز ۹ | همه مشتق‌شده | Reporting |
| تنظیمات/پشتیبان/بازیابی | پیکربندی و بقا | نسخه‌دار | Platform |
| جستجوی سراسری | ⌘K روی حساب/دارایی/سند/هدف | یک اندیس ساده | همه |

# فاز ۵ — قوانین حسابداری (بدون ساده‌سازی)
1. **دوطرفه:** هر سند ≥ ۲ پوستینگ و `Σ base_value = 0`.
2. **انتقال:** خروج از حساب مبدأ (−qty، −value) و ورود به مقصد (+qty، +value)؛ کارمزد پوستینگ سوم به حساب هزینه.
3. **خرید:** `+qty دارایی @ cost` و `−value ارز پرداختی`؛ ایجاد Lot با `unit_cost_base = (value + fee)/qty`.
4. **فروش:** `−qty دارایی` و `+value ارز دریافتی`؛ مصرف Lotها به FIFO؛ اختلاف = **سود/زیان تحقق‌یافته** که به حساب درآمد/هزینه سرمایه‌ای پوستینگ می‌شود تا تراز حفظ شود.
5. **تبدیل ارز (FX):** دو پوستینگ با نرخ لحظه؛ اختلاف نرخ = سود/زیان FX.
6. **میانگین هزینه:** به‌عنوان گزارش موازی محاسبه می‌شود (Σcost/Σqty) اما مبنای مالیاتی FIFO است.
7. **سود تحقق‌نیافته:** `(price_now − avg_cost) × qty_remaining` — هرگز در دفترکل ثبت نمی‌شود (فقط گزارشی).
8. **ارزش خالص:** `Σ(ارزش حساب‌های دارایی) − Σ(مانده بدهی‌ها)`.
9. **بدهی:** ایجاد بدهی = `+دارایی/هزینه` و `+بدهی(منفی در base)`; پرداخت قسط = `−نقد` و `−بدهی` (+هزینه بهره در صورت وجود).
10. **صندوق‌ها:** انتقال داخلی بین حساب‌ها؛ ثروت را تغییر نمی‌دهد، فقط تخصیص را.
11. **آینده:** برنامه‌ها هرگز پوستینگ ندارند تا اجرا شوند.

# فاز ۶ — لایه برنامه‌ریزی مالی
اهداف، خریدهای آینده، هدیه، سفر، مراسم، خریدهای بزرگ، بودجه، جریان نقدی آینده، سناریو (خوش‌بینانه/پایه/بدبینانه با نرخ رشد و تورم)، تراکنش‌های برنامه‌ریزی‌شده با تکرار، تقویم، تایم‌لاین و پیش‌بینی ۱۲ ماهه. موتور Projection: از نقطه «ثروت فعلی» شروع می‌کند، ورودی/خروجی‌های `pending` + اقساط سررسیدنشده + تعهدات تکرارشونده را روی محور زمان می‌ریزد و منحنی نقدینگی و ثروت را می‌سازد؛ هشدار «کسری نقدینگی» در ماه‌های منفی.

# فاز ۷ — UI/UX
**اصول:** Mobile-First با حس اپ بومی؛ مینیمال، آرام، لوکس؛ RTL کامل فارسی؛ فونت **Vazirmatn**؛ اعداد با جداکننده هزارگان و دقت اعشار مخصوص هر دارایی؛ قابلیت انتخاب ارقام فارسی/انگلیسی؛ Dark/Light با کنتراست AA؛ انیمیشن‌های کوتاه (۱۵۰–۲۵۰ms)؛ Bottom Nav در موبایل و Sidebar در دسکتاپ.
**Design System:** مقیاس فاصله ۴px؛ شعاع ۱۶/۲۴px؛ رنگ پایه خنثی + لهجه‌های `mint/emerald` برای رشد و `rose` برای افت؛ تایپوگرافی ۱۲/۱۴/۱۶/۲۰/۲۸/۳۶ با tabular-nums برای اعداد؛ کارت شیشه‌ای با سایه نرم؛ نمودار SVG سبک و تعاملی با انتخاب بازه (۱M/۳M/۶M/۱Y/همه).
**دسترس‌پذیری:** هدف لمسی ≥۴۴px، فوکوس مرئی، aria-label فارسی، احترام به `prefers-reduced-motion`.

# فاز ۸ — جریان‌های کاربر
ورود با PIN → داشبورد → عملیات سریع (+) → انتخاب نوع (انتقال/خرید/فروش/درآمد/هزینه) → فرم تک‌صفحه‌ای با پیش‌نمایش تراز → ثبت → بازگشت با toast. مسیرهای مشابه برای هدف، رویداد، برنامه خرید، پرداخت قسط، مدیریت بدهی، ساخت گزارش، پشتیبان و بازیابی. هر صفحه دارای Breadcrumb/عنوان + یک اقدام اصلی است.

# فاز ۹ — گزارش‌ها
ارزش خالص · عملکرد پرتفوی · تخصیص دارایی · سود و زیان (تحقق‌یافته/نشده) · جریان نقدی · بدهی · تقویم اقساط · پیشرفت اهداف · بودجه رویداد · هزینه‌های آینده · صندوق ذخیره · صندوق خانواده · رشد تاریخی · عملکرد سرمایه‌گذاری · خلاصه ماهانه · خلاصه سالانه.

---

# فاز ۱۰ — پیاده‌سازی
Next.js 16 (App Router) + TypeScript + Drizzle + PostgreSQL + Tailwind v4 + zod + PWA(manifest) + نمودارهای SVG بدون وابستگی سنگین. جزئیات در README و کد.

### ✅ چک‌لیست بازبینی نهایی
معماری ماژولار ✔ · داده نرمال ✔ · دوطرفه و تغییرناپذیر ✔ · پوشش کامل سناریوهای ثروت ✔ · UI حرفه‌ای و RTL ✔ · ناوبری کم‌اصطکاک ✔ · مقیاس‌پذیری با ایندکس و محاسبه در DB ✔ · مستندسازی تصمیم‌ها ✔ · آماده استفاده واقعی ✔
