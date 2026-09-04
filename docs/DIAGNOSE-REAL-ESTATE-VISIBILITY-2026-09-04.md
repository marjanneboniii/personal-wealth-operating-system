# چرا بخش املاک خالی است؟ — Rules of Visibility + Runbook

**تاریخ:** 2026-09-04 · **محدوده:** ماژول «دارایی واقعی و کالا» (`/asset-registry`) ← بخش 🏠 املاک
**ابزار:** `npm run db:diagnose-realestate` (فقط‌خواندنی) · منطق: `src/features/rwa/realEstate/visibility.ts`

---

## ۱) فیلتر واقعیِ نمایش

بخش املاک جدول `assets` را **نمی‌خواند**. تنها ورودی آن `getRealEstateDashboard(userId)` →
`loadProperties(userId)` است (`src/features/rwa/realEstate/service.ts`) و predicate آن این است:

```sql
FROM real_estate_properties p
INNER JOIN assets a ON a.id = p.asset_id
WHERE p.user_id = <شناسه کاربرِ لاگین‌شده>   -- جداسازی tenant (SECURITY، H-01)
  AND a.deleted_at IS NULL                  -- دارایی soft-delete شده = دیگر وجود ندارد
```

`userId` از `ensureAuth()` در صفحه گرفته می‌شود و اپ **login-gated** است؛ پس این فیلتر همیشه اعمال می‌شود.
نتیجه: یک رکورد می‌تواند در دیتابیس سالم موجود باشد و در عین حال در «املاک من» دیده نشود.

## ۲) چهار دلیل ممکن (به ترتیب شیوع)

| # | وضعیت داده | چرا دیده نمی‌شود | راه‌حل مجاز |
|---|---|---|---|
| ۱ | `real_estate_properties.user_id IS NULL` | رکورد پیش از حالت چندکاربرینه ساخته شده و عمداً به هیچ tenant داده نمی‌شود («NULL یعنی مشترک» نیست) | `PWOS_ALLOW_LEGACY_CLAIM=true npm run db:legacy-claim` — فقط وقتی دقیقاً یک کاربر `owner` وجود دارد اجرا می‌شود؛ بعد فلگ را حذف کنید |
| ۲ | `user_id = <کاربر دیگر>` | ملک با حساب دیگری ثبت شده (مثلاً یک‌بار با Google و یک‌بار با نام‌کاربری → دو شناسه متفاوت) | با همان حساب وارد شوید. ادغام حساب فقط با مهاجرت صریح و قابل‌ممیزی؛ هیچ فیلد «انتقال مالکیت» در UI وجود ندارد |
| ۳ | `assets.deleted_at IS NOT NULL` | ملک حذف/فروش شده یا `repairOrphanedRealEstate()` آن را بی‌اثر کرده. `deleteRealEstateAsset` و `sellRealEstateAsset` ردیف ملک را حذف و دارایی را tombstone می‌کنند (نماد `__del_…`) | سند دفترکل و تاریخچه دست‌نخورده‌اند؛ بازگردانی یعنی `deleted_at = NULL` + بررسی اینکه شناسه کوتاه آزادشده (`۰۰۱`…) به دارایی دیگری نچسبیده باشد |
| ۴ | ردیف `assets` هست، ردیف `real_estate_properties` نیست | دارایی از مسیر عمومی «ثبت خرید دارایی» (`/new?type=buy`) ساخته شده. در «همه دارایی‌ها → دارایی‌های واقعی» شمرده می‌شود (چون `splitAssetFamilies` برچسب **کلاس** را می‌بیند) ولی ماژول املاک هرگز آن را نشان نمی‌دهد | برای آن دارایی یک رکورد ملک در تب «ثبت ملک» بسازید، یا آن را در همان مسیر عمومی مدیریت کنید — دو «حقیقت» برای یک دارایی ساخته نمی‌شود |

نشانه‌های جانبی که همان ریشه را تأیید می‌کنند:

* **کارت `دارایی‌های واقعی` در `/assets` تعداد N را نشان می‌دهد ولی جدول املاک خالی است** → حالت ۴ (یا ۱/۲/۳).
* **خودِ ملک فهرست می‌شود ولی «تاریخچه ارزش‌گذاری» خالی است** → `real_estate_valuation_snapshots.user_id` با مالک ملک هم‌خوان نیست؛ `loadSnapshotsByProperty(userId)` اسنپ‌شات‌ها را جداگانه با `user_id` اسکوپی می‌کند.
* **تب به‌جای «املاک من» روی «ثبت ملک» باز می‌شود** → `RealEstateModule` با `dashboard.length === 0` این پیش‌فرض را دارد؛ یعنی فهرست خالی، نه نبودِ بخش.
* **داده پایه خالی است** (شهر/محله/نوع ملک) → فرم ثبت ملک گزینه‌ای ندارد و ثبت جدید عملاً ممکن نیست؛ `ensureRealEstateModuleReady()` سید را یک‌بار اجرا می‌کند اما اگر جدول‌ها تازه‌ساخته باشند، اولین بازدید باید کامل render شود.
* **کل بخش رندر نمی‌شود** (نه اینکه خالی باشد) → خطای سطح صفحه؛ `ensureSchemaOnce`/`npm run db:migrate` را بررسی کنید (نبود `real_estate_properties` در schema).

## ۳) Runbook

```bash
# ۱. تشخیص (هیچ نوشتنی انجام نمی‌دهد؛ نشست با default_transaction_read_only=on باز می‌شود)
npm run db:diagnose-realestate
npm run db:diagnose-realestate -- --user=marjan      # username / email / uuid
npm run db:diagnose-realestate -- --json             # برای ابزار/CI

# ۲. اگر «HIDDEN_NO_OWNER» گزارش شد و فقط یک مالک وجود دارد
PWOS_ALLOW_LEGACY_CLAIM=true npm run db:legacy-claim
# سپس فلگ را از .env حذف کنید تا در deploy بعدی دوباره اجرا نشود

# ۳. اگر دارایی یتیم (حالت ۴) گزارش شد
# repairOrphanedRealEstateAction() در src/app/actions/realEstate.ts وجود دارد اما به هیچ دکمه‌ای در UI متصل
# نیست؛ اجرای آن عملاً از طریق یک اسکریپت ادمین است. توجه: این کار فقط دارایی‌هایی را soft-delete می‌کند که
# هیچ ردیف ملکی/خودرویی/مالکیتی ندارند — پس نمی‌تواند ملکی را که ردیف ملک دارد ناپدید کند، ولی آن دارایی
# یتیم را از «همه دارایی‌ها» هم حذف می‌کند و شناسه کوتاه (۰۰۱…) را آزاد می‌کند.
```

## ۴) چیزی که این ابزار **نمی‌گوید**

* هیچ داده‌ای را ترمیم نمی‌کند و هیچ UPDATE/DELETE ارسال نمی‌کند.
* درباره درست‌بودن **مبلغ‌ها** نظر نمی‌دهد؛ آن از `getPortfolioValuation()` می‌آید (اسناد: `AUDIT-REAL-ESTATE-CLEANUP.md`، `docs/AUDIT-REAL-ASSETS-VALUATION-HISTORY-2026-08-25.md`).
* عیب‌یابی اتصال/SSL: `npm run db:check` · بازرسی schema و مهاجرت‌ها: `npx tsx src/scripts/db-inspect-readonly.ts`.

## ۵) قرارداد آزمون

`tests/real-estate-visibility.test.ts` دو چیز را قفل می‌کند:
۱) معناهای امنیتیِ مسیر خواندن تغییر نمی‌کند (tenant بیگانه، ردیف بی‌مالک، دارایی soft-deleted، اسکوپی اسنپ‌شات)؛
۲) `visibleCount` گزارش تشخیصی **دقیقاً** برابر خروجی `listRealEstateAssets()` است — تشخیصی که با ماژول هم‌خوان نباشد، از نبودِ تشخیص بدتر است.
