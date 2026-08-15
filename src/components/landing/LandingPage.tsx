import Link from "next/link";
import { LandingFooter, LandingHeader } from "@/components/landing/LandingChrome";
import Icon, { type IconName } from "@/components/ui/Icon";

const FEATURES: { icon: IconName; title: string; body: string }[] = [
  {
    icon: "portfolio",
    title: "مدیریت دارایی‌ها",
    body: "سبد دارایی، رمزارز، ملک، خودرو و کالا را در یک محیط یکپارچه ببینید و مدیریت کنید.",
  },
  {
    icon: "transactions",
    title: "ثبت و پیگیری تراکنش‌ها",
    body: "درآمد، هزینه، انتقال و خرید و فروش دارایی با سوابق روشن و قابل پیگیری.",
  },
  {
    icon: "networth",
    title: "ارزش خالص دارایی",
    body: "تصویری واحد از دارایی‌ها منهای بدهی‌ها — تا وضعیت کلی ثروت را بهتر درک کنید.",
  },
  {
    icon: "cashflow",
    title: "نقدینگی و جریان مالی",
    body: "ببینید پول از کجا می‌آید و به کجا می‌رود؛ نقدشونده را از کل ثروت جدا نگه دارید.",
  },
  {
    icon: "reports",
    title: "گزارش‌های مالی",
    body: "گزارش‌های ساختاریافته برای مرور عملکرد، جریان نقدی و تصمیم‌گیری آرام‌تر.",
  },
  {
    icon: "ledger",
    title: "دفترکل و حسابرسی",
    body: "هسته حسابداری دوطرفه و سوابق حسابرسی‌پذیر در پس زمینهٔ همان تصویر انسانی.",
  },
];

function ProductPreview() {
  return (
    <div className="landing-preview" aria-hidden="true">
      <div className="landing-preview-chrome">
        <span />
        <span />
        <span />
      </div>
      <div className="landing-preview-body">
        <p className="muted text-[11px] font-medium">ارزش خالص دارایی</p>
        <p className="display-num mt-1 text-[28px] font-bold tracking-tight sm:text-[34px]" dir="ltr">
          —
        </p>
        <p className="muted mt-1 text-[11px]">پس از ورود، اعداد واقعی حساب شما اینجا می‌آید.</p>
        <div className="mt-5 grid grid-cols-3 gap-3 border-t pt-4" style={{ borderColor: "var(--border)" }}>
          {[
            { label: "کل دارایی‌ها", hint: "یکجا" },
            { label: "بدهی‌ها", hint: "شفاف" },
            { label: "نقدشونده", hint: "آماده" },
          ].map((m) => (
            <div key={m.label}>
              <p className="muted text-[10.5px]">{m.label}</p>
              <div className="mt-2 h-2 w-16 rounded-full" style={{ background: "var(--sunken)" }} />
              <p className="muted mt-1.5 text-[10px]">{m.hint}</p>
            </div>
          ))}
        </div>
        <div className="comp-bar mt-5">
          <span style={{ width: "42%", background: "var(--brand)" }} />
          <span style={{ width: "28%", background: "var(--info)" }} />
          <span style={{ width: "18%", background: "var(--positive)" }} />
          <span style={{ width: "12%", background: "var(--warning)" }} />
        </div>
        <ul className="mt-3 space-y-2">
          {["سبد دارایی", "جریان نقدی", "تراکنش‌های اخیر"].map((row) => (
            <li key={row} className="flex items-center justify-between text-[12px]">
              <span className="sub">{row}</span>
              <span className="h-1.5 w-14 rounded-full" style={{ background: "var(--sunken)" }} />
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

export default function LandingPage() {
  return (
    <div className="landing">
      <LandingHeader />

      <section className="landing-wrap landing-hero">
        <div className="landing-hero-copy">
          <p className="landing-kicker">وِزان · مدیریت خصوصی ثروت</p>
          <h1 className="landing-display">تمام ثروت شما، یک تصویر روشن.</h1>
          <p className="landing-lede">
            وِزان برای دیدن یکپارچه دارایی‌ها، نقدینگی، تراکنش‌ها و ارزش خالص ساخته شده است — تا وضعیت مالی‌تان را آرام‌تر
            ببینید و دقیق‌تر مدیریت کنید.
          </p>
          <div className="mt-7 flex flex-col gap-2.5 sm:flex-row sm:items-center">
            <Link href="/login" className="btn btn-primary !min-h-12 w-full sm:w-auto sm:px-6">
              ورود به سیستم
            </Link>
            <Link href="/register" className="btn !min-h-12 w-full sm:w-auto sm:px-6">
              ایجاد حساب
            </Link>
          </div>
        </div>
        <ProductPreview />
      </section>

      <section className="landing-wrap landing-section" aria-labelledby="glance-title">
        <h2 id="glance-title" className="landing-h2">
          همه ثروت شما در یک نگاه
        </h2>
        <p className="landing-support">یک تصویر یکپارچه از وضعیت مالی — نه چند صفحه پراکنده.</p>
        <div className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {[
            { icon: "networth" as const, title: "ارزش خالص", body: "دارایی‌ها منهای بدهی‌ها، در یک عدد قابل پیگیری." },
            { icon: "portfolio" as const, title: "دارایی‌ها", body: "ترکیب سبد و جایگاه هر کلاس دارایی." },
            { icon: "wallet" as const, title: "نقدینگی", body: "آنچه نقدشونده است، جدا از کل ثروت." },
            { icon: "transactions" as const, title: "تراکنش‌ها", body: "سوابق درآمد، هزینه، انتقال و معاملات." },
            { icon: "trend-up" as const, title: "عملکرد", body: "تغییر ارزش در طول زمان، روی نمودار و گزارش." },
            { icon: "reports" as const, title: "گزارش‌ها", body: "خروجی ساختاریافته برای مرور دوره‌ای." },
          ].map((item) => (
            <article key={item.title} className="landing-glance">
              <Icon name={item.icon} size={18} style={{ color: "var(--brand)" }} />
              <h3 className="mt-3 text-[15px] font-semibold">{item.title}</h3>
              <p className="sub mt-1.5 text-[13px] leading-6">{item.body}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="landing-wrap landing-section" aria-labelledby="features-title">
        <h2 id="features-title" className="landing-h2">
          قابلیت‌هایی که همین حالا در محصول هست
        </h2>
        <p className="landing-support">فقط آنچه واقعاً در وِزان پیاده شده معرفی می‌شود.</p>
        <div className="mt-8 grid gap-4 md:grid-cols-2">
          {FEATURES.map((f) => (
            <article key={f.title} className="landing-card">
              <span className="landing-icon">
                <Icon name={f.icon} size={18} />
              </span>
              <div>
                <h3 className="text-[15px] font-semibold">{f.title}</h3>
                <p className="sub mt-1.5 text-[13.5px] leading-7">{f.body}</p>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="landing-wrap landing-section" aria-labelledby="designed-title">
        <div className="landing-brand-panel">
          <p className="landing-kicker">Designed for wealth management</p>
          <h2 id="designed-title" className="landing-h2">
            برای مدیریت واقعی ثروت شخصی
          </h2>
          <p className="landing-lede mt-4 max-w-2xl">
            نه فقط ثبت یک عدد. بلکه دیدن تصویر کامل دارایی‌ها، جریان مالی و وضعیت خالص ثروت — در محیطی آرام، خصوصی و
            دقیق.
          </p>
        </div>
      </section>

      <section className="landing-wrap landing-section" aria-labelledby="trust-title">
        <h2 id="trust-title" className="landing-h2">
          حریم خصوصی، مالکیت و کنترل
        </h2>
        <p className="landing-support">بدون ادعای امنیتی اثبات‌نشده. فقط آنچه معماری فعلی پشتیبانی می‌کند.</p>
        <div className="mt-8 grid gap-4 md:grid-cols-2">
          {[
            {
              icon: "lock" as const,
              title: "حساب و نشست اختصاصی",
              body: "ورود با نام کاربری یا Google. نشست روی سرور اعتبارسنجی می‌شود و با خروج یا انقضا پایان می‌یابد.",
            },
            {
              icon: "audit" as const,
              title: "مالکیت داده",
              body: "سوابق مالی به حساب شما وابسته‌اند. پشتیبان‌گیری و بازیابی برای نقش‌های مجاز در تنظیمات در دسترس است.",
            },
            {
              icon: "layers" as const,
              title: "کنترل در دست شما",
              body: "شما تراکنش‌ها، دارایی‌ها و نرخ ارز مرجع خود را ثبت و بازبینی می‌کنید — سیستم به‌جای شما تصمیم سرمایه‌گذاری نمی‌گیرد.",
            },
            {
              icon: "info" as const,
              title: "شفافیت به‌جای شعار",
              body: "ادعایی مانند رمزنگاری سرتاسری یا امنیت بانکی مطرح نمی‌کنیم مگر آنکه در همین مخزن پیاده و قابل اثبات باشد.",
            },
          ].map((item) => (
            <article key={item.title} className="landing-card">
              <span className="landing-icon">
                <Icon name={item.icon} size={18} />
              </span>
              <div>
                <h3 className="text-[15px] font-semibold">{item.title}</h3>
                <p className="sub mt-1.5 text-[13.5px] leading-7">{item.body}</p>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="landing-wrap landing-section" aria-labelledby="about-title">
        <h2 id="about-title" className="landing-h2">
          درباره ما
        </h2>
        <p className="landing-lede mt-4 max-w-2xl">
          وِزان برای کسانی ساخته شده که می‌خواهند ثروت شخصی‌شان را یکجا ببینند — بدون پراکندگی بین دفتر، فایل و حافظه.
          مسئله ساده است: تصویر روشن از دارایی، بدهی، نقدینگی و جریان پول، روی هسته‌ای حسابداری که قابل اتکاست.
        </p>
        <p className="sub mt-4 max-w-2xl text-[14px] leading-7">
          این صفحه معرفی محصول است، نه داستان ساختگی یک شرکت. جزئیات تیم وقتی مستند رسمی وجود داشته باشد اینجا می‌آید.
        </p>
        <Link href="/about" className="mt-5 inline-flex min-h-12 items-center text-[13.5px] font-semibold" style={{ color: "var(--brand)" }}>
          ادامه درباره وِزان
        </Link>
      </section>

      <LandingFooter />
    </div>
  );
}
