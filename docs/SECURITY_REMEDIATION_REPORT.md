# گزارش رفع آسیب‌پذیری‌های Authentication / Authorization

تاریخ: 2026-08-10 · شاخه: `arena/019feb59-personal-wealth-operating-syst`

اصل حاکم بر تمام تغییرات: **امنیت اطراف Accounting Core اصلاح شد، نه داخل آن.**
تمام ۱۴۴ تست (۱۳۰ تست موجود + ۱۴ تست امنیتی جدید) سبز هستند. Build تولیدی موفق است.

---

## ۱. فهرست فایل‌های تغییر‌یافته / جدید

### فایل‌های اصلاح‌شده
| فایل | حوزه |
|---|---|
| `src/lib/auth-actions.ts` | Registration / Login / Password policy / Legacy claim |
| `src/lib/auth.ts` | Session token hashing |
| `src/lib/authGuard.ts` | Owner/Admin authorization + مقایسه constant-time |
| `src/lib/rateLimit.ts` | Rate limiting + IP helpers |
| `src/app/actions.ts` | Authorization boundary برای Server Actions |
| `src/app/actions/marketData.ts` | Gate کردن تغییر داده‌های بازار |
| `src/app/actions/commodities.ts` | Gate احراز هویت |
| `src/app/actions/registry.ts` | Gate احراز هویت |
| `src/app/api/auth/google/route.ts` | Role + rate limit + audit |
| `src/app/api/auth/logout/route.ts` | سازگاری با hash session |
| `src/app/api/backup/route.ts` | Audit تلاش‌های ناموفق |
| `src/app/api/restore/route.ts` | Audit + pre-restore snapshot |
| `middleware.ts` | فقط مستندسازی route map (بدون تغییر رفتار) |
| `package.json` | فقط اسکریپت test برای پشتیبانی mock ماژول |
| `.env.example` | مستندسازی `PWOS_ALLOW_LEGACY_CLAIM` |

### فایل‌های جدید
| فایل | هدف |
|---|---|
| `src/lib/accessControl.ts` | Ownership checkهای سند/بدهی/قسط در لایه Authorization |
| `tests/security-remediation.test.ts` | ۱۴ تست رگرسیون امنیتی (سناریوهای §24–29) |

### Database migrations
**هیچ.** هیچ تغییر schema لازم نبود — hash توکن session در همان ستون موجود `sessions.token` ذخیره می‌شود.
هیچ `DROP TABLE` / `DROP COLUMN` / `DELETE DATA` انجام نشد.

---

## ۲. جزئیات هر فایل (Old / New / Reason / Impact)

### `src/lib/auth-actions.ts`
- **Old:** ثبت‌نام username/password با `role: "owner"`؛ حداقل رمز ۶ کاراکتر؛ هر بازدیدکننده ناشناس می‌توانست با ثبت‌نام، Legacy Owner بدون username را Claim کند (`legacyUsers.length === 1` → claim).
- **New:**
  - Role جدید فقط از ثابت backend: `role: "user"`. فیلدهای `role`, `userId`, `googleId`, ... از FormData حذف می‌شوند (mass-assignment).
  - Policy رمز: حداقل ۸ کاراکتر + حداقل یک حرف و یک رقم (فقط ثبت‌نام؛ loginهای قدیمی نمی‌شکنند).
  - Legacy Claim فقط در صورت opt-in صریح اپراتور: `PWOS_ALLOW_LEGACY_CLAIM=true` + audit `LEGACY_OWNER_CLAIM`. بدون flag، همیشه حساب تازه `user` ساخته می‌شود و داده legacy دست‌نخورده می‌ماند.
  - Rate limit بر اساس IP نیز اضافه شد (`register-ip`, `login-ip`).
  - audit رویدادهای `REGISTER`.
- **Reason:** §1, §5, §16, §17, §27.
- **Impact:** Account Takeover از مسیر legacy مسدود شد؛ privilege escalation با `role=owner` بی‌اثر شد؛ brute-force سخت‌تر شد. مسیر migration حذف **نشد**، فقط opt-in شد.

### `src/lib/auth.ts`
- **Old:** `sessions.token = rawToken` به‌صورت خام در DB.
- **New:** DB فقط `sha256(token)` ذخیره می‌کند؛ cookie خام (HttpOnly, SameSite=Lax, Secure در production) و TTL ۳۰ روزه **بدون تغییر**. Lookup بر اساس hash؛ ردیف‌های legacy (خام) در اولین استفاده به hash ارتقا می‌یابند و دیگر هرگز session جدیدی خام ساخته نمی‌شود.
- **Reason:** §13.
- **Impact:** نشت DB دیگر اعتبار session نمی‌دهد. تست‌های موجود (fail-closed, session expiration) بدون تغییر سبز ماندند.

### `src/lib/authGuard.ts`
- **Old:** مقایسه `===` برای `PWOS_AUTH_TOKEN`.
- **New:** مقایسه constant-time (`safeEqual`)؛ helper مشترک `isAdminOrOwner()`؛ خروجی `authorizeOwnerOrAdmin` حالا کاربر را حتی در حالت خطا برمی‌گرداند تا audit دقیق ممکن شود. منطق role (فقط owner/admin) بدون تغییر است اما حالا واقعاً مؤثر است چون ثبت‌نام عمومی دیگر owner نمی‌سازد.
- **Reason:** §2, §20.
- **Impact:** Timing attack روی admin token؛ authorization واقعی owner/admin.

### `src/lib/rateLimit.ts`
- **Old:** Map بدون سقف (خطر رشد بی‌کران حافظه با keyهای ساختگی مهاجم)؛ بدون IP helper.
- **New:** سقف ۲۰۰۰۰ key + eviction ورودی‌های منقضی؛ `getClientIp(request)` و `getRequestIp()` (server actions)؛ `safeEqual`. پنجره‌ها همیشه منقضی می‌شوند → **lockout دائمی ممکن نیست**. rate limit همچنان کاملاً بیرون از Accounting Core است. برای استقرار multi-instance، shared store (مثلاً Redis) در doc توصیه شده است.
- **Reason:** §17.
- **Impact:** مقاومت در برابر memory-exhaustion و brute-force روی `/api/auth/google`, login, register.

### `src/app/actions.ts`
- **Old:**
  - `createTransactionAction`: هیچ ownership check روی accountهای ارسالی client نداشت (IDOR → امکان ثبت سند با حساب کاربر دیگر).
  - `reverseEntryAction` / `markReviewedAction`: `if (je?.userId && je.userId !== user.id)` → سند با `userId = NULL` عبور می‌کرد.
  - `markManyReviewedAction`: بدون هیچ مالکیت.
  - `fetchAnalyticsSummaryAction`, `fetchPortfolioValuationAction`, `fetchSetupStateAction`, `integrityCheckAction`: بدون user context.
  - `createPortfolioSnapshotAction`: snapshot جهانی بدون userId.
  - `updatePriceAction`, `recordManualPriceAction`: هر کاربر لاگین‌شده می‌توانست قیمت‌های جهانی را تغییر دهد.
- **New:**
  - `createTransactionAction`: قبل از هر فراخوانی حسابداری، `validateAccountOwnership` برای `primaryAccountId` و `counterAccountId` و `assertInstallmentOwnership`/`assertDebtOwnership` برای ارجاع‌ها. حساب‌های fee (5040) و PnL (4100) server-side از روی code انتخاب می‌شوند و هرگز از client نمی‌آیند. `postEntry` و تمام توابع record* **بدون تغییر** فراخوانی می‌شوند.
  - مالکیت سخت برای reverse/review: `je.userId === user.id` شرط قطعی است؛ سند بدون owner → **DENY** (برای کاربر عادی و حتی admin؛ پاک‌سازی داده‌های orphan از مسیر restore ممکن است).
  - `markManyReviewedAction`: تأیید مالکیت تک‌تک اسناد؛ batch غیرمجاز کلاً رد می‌شود.
  - `executePlanAction`: مالکیت حساب‌های from/to پلن قبل از اجرا.
  - `payInstallmentAction`: مالکیت `cashAccountId` ارسالی client.
  - `createBudgetAction`/`createGoalAction`/`createPlannedAction`: مالکیت ارجاع‌های حساب.
  - Actionهای خواندن user-specific: gate «auth فعال و بدون session → DENY» + پاس دادن `user.id` به `getAnalyticsSummary(user.id)`، `getPortfolioValuation(undefined, user.id)`، `createPortfolioSnapshot(undefined, user.id)`. **منطق محاسباتی هیچ‌کدام تغییر نکرد.**
  - تغییر قیمت بازار و setup اولیه: فقط owner/admin وقتی auth فعال است (حالت single-tenant بدون تغییر).
- **Reason:** §6, §7, §8, §9, §10, §11, §12, §25, §26.
- **Impact:** User A نمی‌تواند هیچ Journal Entry / Posting / FIFO Lot / مانده‌ای با حساب‌های User B بسازد یا تغییر دهد.

### `src/app/api/auth/google/route.ts`
- **Old:** کاربر جدید Google با `role: "owner"` ساخته می‌شد.
- **New:** `role: "user"`؛ rate limit بر اساس IP علاوه بر email؛ audit رویداد `OAUTH_TAKEOVER_DENIED`. تمام بررسی‌های existing (audience, issuer, sub, email, email_verified, expiration از tokeninfo گوگل) **کاملاً حفظ شدند** — هیچ مسیری emailِ client را قبول نمی‌کند؛ درخواست `{email: victim}` بدون توکن → 401. `googleId = sub` همچنان identity اصلی است و email تنها identity نیست.
- **Reason:** §1, §14, §15, §17, §28, §29.

### `src/app/api/backup/route.ts` / `restore/route.ts`
- **Old:** فقط gate مجاز/غیرمجاز؛ تلاش‌های ردشده audit نمی‌شدند؛ restore بدون ردپای pre-restore.
- **New:** audit `BACKUP_DENIED` / `RESTORE_DENIED` با status؛ قبل از restore، snapshot تعداد ردیف جداول حساس در `backup_runs` با kind=`pre_restore_snapshot` ثبت می‌شود (این جدول جزو لیست restore نیست لذا بعد از restore هم باقی می‌ماند). Role فقط از session سمت سرور؛ `request.body.userId/role` هرگز خوانده نمی‌شود. **منطق داخلی backup/restore بدون تغییر.**
- **Reason:** §3, §4, §30.

### `middleware.ts`
- رفتار بدون تغییر (`NextResponse.next()`) — طبق دستور، کورکورانه تغییر داده نشد. فقط route map (public / authenticated / owner-admin) مستند شد. Authorization واقعی همان‌طور که لازم است در Server/API/Server Actions/Service boundary اجرا می‌شود. (**§18**)

### `package.json`
- فقط اسکریپت `test` برای پشتیبانی `mock.module` (شبیه‌سازی `next/headers` در تست‌های server action). هیچ وابستگی اضافه/حذف نشد.

---

## ۳. ماتریس تست (§24–29) — همگی اجرا و سبز

`tests/security-remediation.test.ts` (جدید) + تست‌های امنیتی موجود:

| سناریو | نتیجه |
|---|---|
| Fake email only (بدون توکن Google) | ❌ 401 ✓ |
| Fake Google token | ❌ 401 ✓ |
| Wrong audience (client id دیگر) | ❌ 401 ✓ |
| Wrong issuer / Unverified email / Expired | ❌ 401 ✓ (تست‌های موجود) |
| Valid Google account | ✅ PASS + role `user` ✓ |
| `role=owner` در request ثبت‌نام | نادیده گرفته → role `user` ✓ |
| Normal User → Backup | ❌ 403 ✓ |
| Normal User → Restore | ❌ 403 ✓ |
| Admin/Owner → Backup | ✅ allowed ✓ |
| User A → createTransaction با حساب User B | ❌ deny + **هیچ** entry/posting/lot ساخته نشد ✓ |
| User A → reverseEntry سند User B | ❌ deny + سند دقیقاً بدون تغییر ✓ |
| سند بدون owner → reverse | ❌ DENY (نه allow) ✓ |
| Owner → reverse سند خودش | ✅ reversal accounting بدون تغییر ✓ |
| Google login با email قربانی (بدون session قربانی) | ❌ 409 + حساب قربانی دست‌نخورده ✓ |
| Legacy claim بدون مجوز اپراتور | ❌ حساب جدید `user`؛ legacy دست‌نخورده ✓ |
| Legacy claim با `PWOS_ALLOW_LEGACY_CLAIM=true` | ✅ مسیر migration حفظ شد ✓ |
| Session token در DB | فقط hash؛ خام هرگز ✓ |
| تغییر قیمت بازار توسط user عادی | ❌ deny؛ owner ✅ ✓ |

**Accounting regression (قبل و بعد یکسان):** تمام ۱۳۰ تست قبلی شامل FIFO lot selection، buy/sell، realized/unrealized PnL، account balance، general ledger، trial balance، journal reversal، transaction approval و idempotency بدون هیچ تغییری سبز هستند.

---

## ۴. نکات باقی‌مانده / توصیه‌ها

1. **Multi-instance:** rate limiter درون‌حافظه‌ای است؛ برای استقرار چند نمونه‌ای، Redis جلوی endpointهای auth توصیه می‌شود (در `rateLimit.ts` مستند شده).
2. **ارتقای role:** برای ارتقای یک کاربر به admin/owner، به‌روزرسانی مستقیم DB توسط اپراتور یا restore توسط owner فعلی لازم است — هیچ مسیر خودکاری وجود ندارد (by design).
3. **محیط تست PGlite:** محدودیت از پیش موجود: query روی `db` داخل `db.transaction` باز در PGlite deadlock می‌کند؛ این فقط محدودیت محیط تست است و در PostgreSQL واقعی (connection pool) وجود ندارد. تست‌های جدید با الگوی تست‌های موجود (فراخوانی مستقیم سرویس حسابداری) نوشته شده‌اند.

---

# ACCOUNTING CORE PRESERVATION REPORT

بدین‌وسیله اعلام می‌شود که در این رفع آسیب‌پذیری، وضعیت هسته حسابداری به شرح زیر است:

| جزء | وضعیت |
|---|---|
| FIFO | **unchanged** (`src/domain/fifo.ts` + مصرف lot در posting دست نخورده) |
| General Ledger | **unchanged** |
| Journal Posting Logic (`postEntry`) | **unchanged** |
| Chart of Accounts | **unchanged** |
| Trial Balance | **unchanged** |
| Realized PnL | **unchanged** |
| Unrealized PnL | **unchanged** |
| Cost Basis | **unchanged** |
| Lot Selection | **unchanged** |
| Transaction Approval | **unchanged** |
| Reversal Accounting | **unchanged** (فقط ownership check قبل از فراخوانی `reverseEntry` اضافه شد) |
| Financial Database Tables | **unchanged** (هیچ migration، هیچ DROP/DELETE) |
| Financial Calculations / Rounding / Currency logic | **unchanged** |

تأیید ماشینی: `git diff --name-only` هیچ فایلی در `src/domain/`, `src/features/ledger/`, `src/features/portfolio/`, `src/features/analytics/`, `src/features/planning/`, `src/features/setup/`, `src/features/integrity/`, `src/features/valuation/`, `src/features/marketData/service`, یا `src/db/` را نشان نمی‌دهد.

**هیچ موردی از موارد فوق تغییر نکرده است.** تمام بررسی‌های ownership صرفاً در لایه‌های Action/API/Authorization و **قبل** از ورود به سرویس‌های حسابداری موجود اعمال شده‌اند.
