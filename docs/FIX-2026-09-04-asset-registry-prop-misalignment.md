# رفع: «املاک من» در `/asset-registry` نمایش داده نمی‌شد + خطای سراسری صفحه

**تاریخ:** 2026-09-04 · **محدوده:** `src/app/asset-registry/page.tsx` · ماژول 🏠 املاک (`RealEstateModule`)
**شدت:** 🔴 بحرانی (نمایشی) — هیچ دادهٔ مالی تغییر نکرده است؛ دفترکل، اسناد و تاریخچه ارزش‌گذاری دست‌نخورده‌اند.

---

## ۱) علت ریشه‌ای — جابه‌جایی یک‌خانه‌ای در `Promise.all`

صفحه مدلِ نمایش خود را با یک destructuringِ **موقعیتی** می‌ساخت:

```ts
const [
  vehicles, ownerships, categories, items, prices,
  vehicleBrands, vehicleModels, vehicleDashboard, vehicleSummary,
  payoutAccounts,          // ⬅ جایگاه ۱۰
  realEstateDashboard,     // ⬅ جایگاه ۱۱
  realEstateSummary,       // ⬅ جایگاه ۱۲
  cities, neighborhoods, propertyTypes, portfolioValuation,
] = await Promise.all([
  …, getVehiclePortfolioSummary(userId),
  getRealEstateDashboard(userId),          // ⬅ جایگاه ۱۰
  getRealEstatePortfolioSummary(userId),   // ⬅ جایگاه ۱۱
  listCities(true),                        // ⬅ جایگاه ۱۲
  listNeighborhoods(undefined, true),
  listPropertyTypes(true),
  getAccountBalances(…),                   // ⬅ جایگاه ۱۵ (payoutAccounts اینجاست)
  getPortfolioValuation(…),
]);
```

ترتیبِ آرایه یک خانه جلوتر از ترتیبِ destructuring بود، بنابراین هر مقدار از خانهٔ بعدی خوانده می‌شد:

| نام متغیر | مقداری که واقعاً دریافت می‌کرد |
|---|---|
| `payoutAccounts` | فهرست املاک (`RealEstateDashboardItem[]`) |
| `realEstateDashboard` | **خلاصهٔ پرتفوی** (`RealEstatePortfolioSummary` — یک شیء، نه آرایه) |
| `realEstateSummary` | فهرست شهرها (`City[]`) |
| `cities` | فهرست محله‌ها |
| `neighborhoods` | فهرست انواع ملک |
| `propertyTypes` | حساب‌های پرداخت |

چون `RegistryWorkspace` با `any` تایپ شده بود، TypeScript هم نمی‌توانست این جابه‌جایی را بگیرد.

## ۲) دو علامتِ گزارش‌شده و توضیح دقیق آن‌ها

1. **«املاک من» اصلاً دیده نمی‌شد.**
   `RealEstateModule` تب پیش‌فرض را با `dashboard.length ? "list" : "add"` انتخاب می‌کند.
   `dashboard` یک شیء بود → `length === undefined` → همیشه تب «ثبت ملک» باز می‌شد.
   نوار خلاصه هم با `summary.count > 0` کنترل می‌شود؛ `summary` آرایهٔ شهرها بود → `count === undefined` → نوار «مجموع ارزش املاک / تعداد ملک / نرخ جاری سیستم» هم هرگز رندر نمی‌شد.

2. **با کلیک روی «املاک من» صفحهٔ خطا می‌آمد.**
   در شاخهٔ فهرست، `dashboard.length === 0` برای `undefined` برقرار نیست، پس کد وارد حلقه می‌شود:
   `TypeError: dashboard.map is not a function` → `src/app/error.tsx`
   → «مشکلی در نمایش این صفحه پیش آمد … داده‌های مالی شما در دفترکل امن‌اند».

   (همین خطا کل صفحه را می‌گرفت؛ بخش‌های خودرو و کالا هم با آن پایین می‌آمدند.)

فرم «ثبت ملک» هم بی‌سر و صدا خراب بود: چون محله‌ها همان انواع ملک بودند، انتخابِ محله برای هیچ شهری گزینه‌ای نداشت و ثبت ملک جدید عملاً ناممکن بود.

## ۳) اصلاح

| # | تغییر | فایل |
|---|---|---|
| ۱ | مدلِ نمایشِ صفحه با **نام** بارگذاری می‌شود، نه با موقعیت: `allNamed({ … })` نتایج را با همان کلیدی برمی‌گرداند که پرس‌وجو با آن ساخته شده است | `src/lib/namedPromises.ts` (جدید) · `src/features/registry/loadAssetRegistryData.ts` (جدید) · `src/app/asset-registry/page.tsx` |
| ۲ | props مربوط به املاک در `RegistryWorkspace` **تایپ واقعی** گرفتند؛ جابه‌جایی لیست/خلاصه حالا خطای کامپایل است، نه صفحهٔ خالی | `src/components/registry/RegistryWorkspace.tsx` |
| ۳ | `RealEstateModule` شکلِ ورودی را ایمن‌سازی می‌کند (`asArray` / `asSummary`). دادهٔ بدِ احتمالی به حالت خالی تنزل می‌یابد، نه به خطای سراسری | `src/components/registry/realestate/RealEstateModule.tsx` |
| ۴ | یک `ErrorBoundary` محلی؛ خرابیِ یک کارت دیگر کل فضای کاری را نمی‌بندد | `src/components/ui/ErrorBoundary.tsx` (جدید) |
| ۵ | نرخ جاری واقعی کاربر به «نرخ جاری سیستم» پاس داده می‌شود (قبلاً همیشه `۰` بود) | `src/features/registry/loadAssetRegistryData.ts` |
| ۶ | تستِ بازگشت: رندرِ واقعیِ سرورِ `/asset-registry` با نشست و ملک واقعی | `tests/asset-registry-page.test.ts` (جدید) |

## ۴) چرا دوباره تکرار نمی‌شود

* `Promise.all` موقعیتی در این صفحه دیگر وجود ندارد: مقدار فقط با همان نامی خوانده می‌شود که با آن تولید شده است.
* جابه‌جایی «لیست در برابر خلاصه» حالا **خطای کامپایل** است (`RealEstateDashboardItem[]` ≠ `RealEstatePortfolioSummary`).
* `tests/asset-registry-page.test.ts` با جابه‌جا کردنِ عمدیِ دو مقدار در loader، **شکست** می‌خورد (تأیید شده) و با اصلاح، pass می‌شود.
* حتی اگر داده‌ای با شکلِ اشتباه برسد، ماژول به‌جای پرتاب خطا حالت خالی را نشان می‌دهد و بقیهٔ صفحه سر جای خود می‌ماند.

## ۵) پوشش داده‌های مالی — «هیچ چیز تغییر نکرده است»

* ❌ هیچ سند دفترکل، posting، lot یا رکورد حسابرسی ایجاد/اصلاح/حذف نشد.
* ❌ هیچ مایگریشن مخربی اجرا نشد.
* ✅ فقط لایهٔ خواندن (read model) و ارائه (presentation) اصلاح شد.
* ✅ رفتارِ مالکیت/جداسازی tenant دقیقاً همان است که در
  `docs/DIAGNOSE-REAL-ESTATE-VISIBILITY-2026-09-04.md` توضیح داده شده؛ این رفع فقط اشتباهِ نگاشتِ props بود،
  نه تغییر در قواعدِ نمایش (cases ۱–۴ آن سند همچنان معتبرند).
