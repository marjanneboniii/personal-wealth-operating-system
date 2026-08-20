# وِزان — Design System Contract

> هویت: **Calm Ledger**. این سند قرارداد بصری محصول است، نه دعوت به بازطراحی.
> ۷۰٪ حفظ هویت فعلی + ۳۰٪ انسجام سیستمی. ظاهر وِزان را به OpenDesign / Linear / Notion / Stripe تبدیل نکنید.

منابع الهام (فقط اصول مفید، نه ظاهر):

| Open Design Principle | Vezan Current State | Gap | Required Change | Vezan File |
|---|---|---|---|---|
| Design tokens as contract | Tokenهای Calm Ledger در `:root` / `.dark` | `--surface-2` مصرف می‌شد بدون تعریف | جایگزینی با `--sunken` / `--hover` | `src/app/globals.css` |
| Spacing consistency | مقیاس ۴px ضمنی | چند `min-height` زیر ۴۴px | هدف لمسی ≥۴۴px | `globals.css`, buttons, sheets |
| Visual hierarchy — one primary question | صفحات سؤال‌محور | داشبورد گاهی Action Center را دیر نشان می‌داد | Decision-first: KPI → تصمیم → تحلیل | `OverviewDashboard.tsx` |
| Mobile-first composition | Bottom nav + sidebar | لندینگ طولانی و دسکتاپ‌گرا | لندینگ کوتاه، CTA موبایل‌اول | `LandingPage.tsx` |
| No decorative noise | مینیمال | چند `rise` همزمان | motion فقط functional | `Card.tsx`, `globals.css` |
| No card soup | قانون موجود | لندینگ با کارت‌های اعتماد زیاد | trust strip به‌جای ۴ کارت | `LandingPage.tsx` |
| Component consistency | Card / Sheet / Icon | رنگ asset-class سخت‌کد | توکن `--asset-*` | `globals.css`, `net-worth/page.tsx` |
| Accessibility | ARIA در Shell / Sheet | dialog بدون labelledby در برخی جاها | `aria-labelledby` + focus trap | `Sheet.tsx`, `IosInstallGuide.tsx` |
| Reduced motion | media query موجود | انیمیشن ورود صفحه روی همه Section | خاموشی کامل در `prefers-reduced-motion` | `globals.css` |
| RTL + financial numerals | Vazirmatn + tabular-nums | نباید تغییر کند | حفظ فرمت اعداد فعلی | `src/lib/format.ts` (دست‌نخورده) |

---

## Color tokens

سطوح:

- `--bg` پس‌زمینه صفحه
- `--surface` سطح محتوا
- `--surface-elev` سطح بالاتر (دیالوگ، شیت، نوار شناور)
- `--sunken` فرورفتگی / پس‌زمینه کمکی
- `--hover` حالت شناور

متن: `--text` · `--text-2` · `--text-3`

مرز: `--border` · `--border-strong`

برند (iris — هرگز برای مثبت/منفی مالی): `--brand` · `--brand-strong` · `--brand-soft` · `--on-brand`

معنایی (فقط معنا، نه تزیین): `--positive` · `--negative` · `--warning` · `--info` و جفت `-soft`

کلاس دارایی (فقط ترکیب، نه جهت پول): `--asset-cash` · `--asset-investment` · `--asset-crypto` · `--asset-other`

`--surface-2` وجود ندارد. از `--sunken` یا `--hover` استفاده کنید.

## Typography

Vazirmatn. اعداد مالی: `.num` / `.display-num` با `font-variant-numeric: tabular-nums`.
اعداد لاتین در `.ltr-isolate` / `[dir=ltr]`. فرمت‌کنندهٔ موجود (`src/lib/format.ts`) تنها منبع حقیقت نمایش عدد است.

## Spacing

مقیاس ۴px. فاصله بخش‌ها `space-y-8` / `space-y-9`. هدف لمسی حداقل ۴۴px.

## Radius

`--r-sm` 8 · `--r-md` 12 · `--r-lg` 16 · `--r-xl` 20. کارت ۱۶، نه شعاع دلخواه.

## Elevation

`--shadow-sm/md/lg` فقط برای ارتفاع واقعی. بدون glow.

## Motion

ورود صفحه ۱۵۰–۲۵۰ms. `.rise` فقط روی قهرمان صفحه، نه روی همه Section همزمان.
`prefers-reduced-motion: reduce` همه animation غیرضروری را خاموش می‌کند.

## Financial semantic colors

سبز/قرمز فقط جهت پول. همیشه با فلش، علامت +/− یا متن همراه است.

## Asset-class colors

فقط از `--asset-*`. رنگ کلاس دارایی را در صفحه hardcode نکنید.

## Charts

SVG داخلی. `role="img"` + `aria-label` فارسی. متن جایگزین در `sr-only` وقتی روند توصیف‌پذیر است.

## Tables

`.table` + `.td-num` با tabular-nums و تراز چپ برای عدد.

## Cards

فقط برای گروه معنایی واقعی. جداکننده و فضای خالی بر کارت ارجح است.

## Dialogs / Sheets

`role="dialog"` · `aria-modal="true"` · `aria-labelledby` · Escape · backdrop · focus trap · safe-area.

## Forms

 Progressive disclosure: اول «چه اتفاقی افتاد؟»، بعد مبلغ/حساب/تاریخ، جزئیات حسابداری در `details`.

## Buttons

`.btn` حداقل ۴۴px. Primary = برند. Ghost برای اقدام ثانویه.

## Mobile navigation

خانه · پول · ثبت (+) · ثروت · بیشتر.
`+` شیت اقدامات سریع را باز می‌کند (هزینه، درآمد، انتقال، خرید، فروش).
`padding-bottom: env(safe-area-inset-bottom)`.

## Desktop navigation

سایدبار گروه‌بندی‌شده مطابق `src/lib/nav.ts`. صفحات فنی (دفترکل، سوابق، حسابرسی) در Advanced.

## RTL

`html dir="rtl" lang="fa"`. اعداد مالی LTR isolate.

## Accessibility

کنتراست AA، focus-visible برند، skip-link، `aria-current` / `aria-expanded` / `aria-live`، هدف لمسی ۴۴px.

## Responsive breakpoints

ابتدا ۳۶۰ / ۳۷۵ / ۳۹۰ / ۴۳۰. سپس `sm` ۶۴۰، `md` ۷۶۸، `lg` ۱۰۲۴، hero لندینگ ۹۶۰.

## PWA

`lang=fa` · `dir=rtl` · `display=standalone` · آیکون ۱۹۲/۵۱۲ + maskable.
SW: استاتیک cache-first؛ ناوبری network-only + `/offline`؛ هیچ API و هیچ HTML خصوصی در Cache Storage.
پس از نصب (`standalone` / `navigator.standalone`) دکمه Download iOS نمایش داده نمی‌شود.

## Landing rules

کوتاه، premium، mobile-first، conversion-oriented.
ساختار: Header → Hero → Preview → ۳–۴ benefit → trust strip → CTA نهایی → Footer.
بدون توضیح FIFO، دفترکل، posting، schema یا امنیت اثبات‌نشده.
CTAها: ورود به سیستم · ایجاد حساب · Download iOS.

## Anti-patterns

- no arbitrary colors
- no arbitrary shadows
- no arbitrary radii
- no decorative green/red
- no card soup
- no unnecessary animation
- no emoji UI icons
- no desktop-first layout
- no dense accounting UI on landing
- no oversized marketing copy
- no undefined tokens (`--surface-2`)
- no caching private financial HTML or API responses
- no new number/currency formatters
