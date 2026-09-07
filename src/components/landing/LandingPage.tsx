import Link from "next/link";
import { LandingFooter, LandingHeader } from "@/components/landing/LandingChrome";
import BrandMark from "@/components/layout/BrandMark";

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-[var(--cloud)] text-[var(--ink)]">
      <LandingHeader />

      {/* ───────────────── Hero Section ───────────────── */}
      <section className="hero container">
        <span className="eyebrow">
          <span className="dot"></span> سیستم‌عامل یکپارچه مدیریت دارایی‌ها و ارزش خالص
        </span>
        <h1>
          تمام ثروت و دارایی‌های شما،<br />
          در یک تصویر شفاف و آرام
        </h1>
        <p className="lede">
          بدون نیاز به اکسل‌های پیچیده یا اتصال ناامن بانکی. توازن ارزش روز دارایی‌های واقعی، نقدینگی، بدهی‌ها و
          اقساط شما را هوشمندانه تجمیع می‌کند تا با آرامش تصمیم بگیرید.
        </p>
        <div className="hero-ctas">
          <Link href="/register" className="btn btn-primary btn-lg">
            ساخت حساب رایگان و شروع
          </Link>
          <Link href="/watch" className="btn btn-ghost btn-lg">
            مشاهده تور تعاملی توازن
          </Link>
        </div>

        {/* Hero Visual: Wealth status mock */}
        <div className="wealth-mock" aria-label="پیش‌نمایش دستیار هوشمند توازن">
          <div className="chat-mock-head">
            <span className="chat-avatar" aria-hidden="true">
              <BrandMark size={16} />
            </span>
            <div>
              <strong>دستیار همراه توازن</strong>
              <span>پایش لحظه‌ای فعال</span>
            </div>
          </div>
          <div className="bubble in">
            سلام! ارزش خالص دارایی‌های من با ثبت آخرین قسط چقدر شد؟
          </div>
          <div className="bubble out">
            ارزش خالص شما به ۱۲۵٬۰۰۰٬۰۰۰ تومان رسید؛ ۱۸۰ میلیون دارایی با کسر ۵۵ میلیون تعهدات و اقساط ⚖️
          </div>
          <div className="mt-3 pt-3 border-t border-[var(--line-soft)] flex items-center justify-between text-[0.78rem]">
            <span className="text-[var(--slate-500)]">نسبت دارایی به بدهی:</span>
            <span className="font-bold text-[var(--sky-700)] num">۳.۲۷ برابر</span>
          </div>
          <div className="chat-input mt-2">
            <input
              type="text"
              placeholder="ثبت تغییرات دارایی یا موعد قسط جدید…"
              disabled
              aria-label="ورودی نمونه پیام دستیار"
            />
            <button aria-label="ارسال آزمایشی" disabled>
              ↑
            </button>
          </div>
        </div>
      </section>

      {/* ───────────────── Trust Strip ───────────────── */}
      <div className="trust-strip">
        <div className="container">
          <span>پوشش کامل کلاس‌های دارایی شما بدون نیاز به اتصال مستقیم بانکی:</span>
          <strong>حساب و نقدینگی</strong>
          <strong>املاک و مسکن</strong>
          <strong>طلا و سکه</strong>
          <strong>خودرو</strong>
          <strong>سهام و رمزارز</strong>
          <strong>بدهی و اقساط</strong>
        </div>
      </div>

      {/* ───────────────── Core Modules Grid ───────────────── */}
      <section className="section container" id="modules">
        <div className="section-head">
          <div>
            <span className="badge">۴ ماژول یکپارچه</span>
            <h2>ستون‌های سیستم‌عامل ثروت توازن</h2>
            <p>هر ابزار برای برطرف کردن یک دغدغه مالی اساسی با معماری آرام و دقیق طراحی شده است.</p>
          </div>
        </div>

        <div className="grid grid-communities">
          {/* Featured Card */}
          <div className="card card-featured">
            <div>
              <span className="badge">داشبورد هسته</span>
              <h3 className="mt-3.5 text-white">محاسبه هوشمند ارزش خالص و پورتفوی کل</h3>
              <p className="text-[0.9rem] mt-1.5 leading-6">
                تجمیع خودکار ارزش روز تمام دارایی‌های فیزیکی و دیجیتال، کسر بدهی‌ها و نمایش روند رشد پیوسته ثروت در یک نگاه.
              </p>
            </div>
            <div className="card-meta mt-4 flex items-center justify-between">
              <span>دید ۳۶۰ درجه به دارایی</span>
              <Link href="/register" className="card-link text-white hover:underline">
                ورود به داشبورد ←
              </Link>
            </div>
          </div>

          {/* Standard Card 1 */}
          <div className="card card-standard">
            <span className="card-icon">ب</span>
            <h3>دفتر کل بدهی‌ها و اقساط</h3>
            <p className="text-[0.88rem] text-[var(--slate-500)] leading-6">
              جدول سررسید هوشمند، محاسبه اصل و سود تسهیلات و جلوگیری از جریمه دیرکرد وام‌ها.
            </p>
            <p className="card-meta">پایش موعد پرداخت اقساط</p>
            <Link href="/register" className="card-link">
              مدیریت بدهی‌ها ←
            </Link>
          </div>

          {/* Standard Card 2 */}
          <div className="card card-standard">
            <span className="card-icon">ت</span>
            <h3>ردیاب تورم شخصی</h3>
            <p className="text-[0.88rem] text-[var(--slate-500)] leading-6">
              سنجش تغییرات قدرت خرید بر اساس سبد مصرفی واقعی شما، مستقل از آمارهای کلی.
            </p>
            <p className="card-meta">محاسبه نرخ حفظ ارزش پول</p>
            <Link href="/register" className="card-link">
              پایش تورم ←
            </Link>
          </div>
        </div>
      </section>

      {/* ───────────────── Guides & Insights Grid ───────────────── */}
      <section className="section container" id="insights">
        <div className="section-head">
          <div>
            <h2>راهنماها و بینش‌های تصمیم‌گیری مالی</h2>
            <p>یادداشت‌ها و الگوهای تدوین‌شده برای ایجاد انضباط مالی و ساخت پورتفوی پایدار</p>
          </div>
          <Link href="/watch" className="btn-text">
            تور کامل توازن ←
          </Link>
        </div>

        <div className="grid grid-blog">
          {/* Featured Article */}
          <article className="post-feature">
            <div className="thumb">
              <span className="badge bg-white/90 text-[var(--sky-900)] font-bold">راهنمای بنیادین</span>
            </div>
            <div className="body">
              <h3 className="text-[1.15rem]">فرمول واقعی ارزش خالص: تفاوت دارایی مولد با دارایی مصرفی</h3>
              <p className="text-[var(--slate-500)] text-[0.9rem] leading-6">
                چرا گران‌تر شدن خودرو یا وسایل شخصی به معنای ثروتمندتر شدن نیست و چگونه باید سرمایه نقدی و مولد را از دارایی راکد تفکیک کرد.
              </p>
              <p className="card-meta mt-1">۱۵ شهریور ۱۴۰۵ · ۸ دقیقه مطالعه</p>
            </div>
          </article>

          {/* Article List */}
          <div className="post-list">
            <div className="post-row">
              <h3>چرا عدم اتصال به حساب بانکی امن‌ترین شیوه ثبت داده‌های مالی است؟</h3>
              <p className="card-meta">۱۴ شهریور ۱۴۰۵ · ۵ دقیقه</p>
            </div>
            <div className="post-row">
              <h3>استراتژی گلوله برفی یا بهمن: بهترین روش تسویه بدهی‌های چندگانه</h3>
              <p className="card-meta">۱۲ شهریور ۱۴۰۵ · ۶ دقیقه</p>
            </div>
            <div className="post-row">
              <h3>محاسبه تورم اختصاصی سبد هزینه خانوار در مقایسه با شاخص رسمی</h3>
              <p className="card-meta">۱۰ شهریور ۱۴۰۵ · ۷ دقیقه</p>
            </div>
          </div>
        </div>
      </section>

      {/* ───────────────── Final CTA Band ───────────────── */}
      <section className="py-16 bg-[var(--white)] border-t border-[var(--line-soft)]">
        <div className="container text-center">
          <span className="eyebrow mb-3">شروع مسیر انضباط مالی</span>
          <h2 className="text-[1.8rem] font-extrabold text-[var(--ink)] mt-2">
            امروز اولین قدم را برای شفافیت ثروت خود بردارید
          </h2>
          <p className="text-[var(--slate-500)] text-[0.95rem] max-w-xl mx-auto mt-3 leading-7">
            ثبت‌نام در توازن کمتر از دو دقیقه زمان می‌برد و برای استفاده از امکانات اصلی نیازی به پرداخت هزینه یا اطلاعات کارت بانکی نیست.
          </p>
          <div className="hero-ctas mt-6">
            <Link href="/register" className="btn btn-primary btn-lg">
              ایجاد حساب کاربری رایگان
            </Link>
            <Link href="/login" className="btn btn-ghost btn-lg">
              ورود به حساب موجود
            </Link>
          </div>
        </div>
      </section>

      <LandingFooter />
    </div>
  );
}

