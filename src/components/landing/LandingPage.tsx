import Link from "next/link";
import { LandingFooter, LandingHeader } from "@/components/landing/LandingChrome";
import Icon, { type IconName } from "@/components/ui/Icon";

/**
 * Static demo amounts for the public landing preview only.
 * Hardcoded Toman samples — not user data, not API, not ledger, not FX.
 */
const PREVIEW_SAMPLE = {
  netWorth: "۱۸۴٬۲۴۰٬۰۰۰ تومان",
  assets: "۲۴۱٬۸۰۰٬۰۰۰ تومان",
  debts: "۵۷٬۵۶۰٬۰۰۰ تومان",
  liquidity: "۴۲٬۳۰۰٬۰۰۰ تومان",
} as const;

const OUTCOMES: { icon: IconName; title: string; body: string; tone: "wealth" | "commitments" | "expenses" }[] = [
  { icon: "networth", title: "ارزش خالص", body: "بدانید امسال واقعاً ثروتمندتر شده‌اید یا نه.", tone: "wealth" },
  { icon: "portfolio", title: "دارایی‌ها", body: "از حساب بانکی تا ملک و طلا، همه‌جا یک‌جا.", tone: "wealth" },
  { icon: "debts", title: "بدهی‌ها", body: "هیچ قسط یا بدهی‌ای از چشمتان دور نمی‌ماند.", tone: "commitments" },
  { icon: "wallet", title: "نقدینگی", body: "همین امروز بدانید چقدر پول واقعی در دست دارید.", tone: "expenses" },
];

const STEPS: { icon: IconName; title: string; body: string }[] = [
  {
    icon: "plus",
    title: "دارایی‌ها و بدهی‌هایتان را اضافه کنید",
    body: "هر چیزی — حساب بانکی، ملک، طلا، سرمایه‌گذاری یا وام — را دستی اضافه کنید.",
  },
  {
    icon: "scale",
    title: "توازن خودکار محاسبه می‌کند",
    body: "ارزش خالص، نقدینگی و روند تغییرات به‌طور لحظه‌ای به‌روزرسانی می‌شود.",
  },
  {
    icon: "overview",
    title: "با یک نگاه تصمیم بگیرید",
    body: "یک داشبورد واحد، بدون نیاز به فرمول‌نویسی یا محاسبه دستی.",
  },
];

const FAQ_ITEMS: { question: string; answer: string }[] = [
  {
    question: "آیا استفاده از توازن رایگان است؟",
    answer: "بله؛ استفاده از توازن رایگان است و برای شروع فقط به یک حساب کاربری نیاز دارید.",
  },
  {
    question: "آیا باید حساب بانکی‌ام را وصل کنم؟",
    answer:
      "خیر؛ توازن هیچ اتصالی به حساب بانکی شما ندارد. دارایی‌ها و بدهی‌ها را خودتان وارد می‌کنید و همیشه کنترل کامل داده‌هایتان را دارید.",
  },
  {
    question: "اطلاعات مالی من کجا ذخیره می‌شود و چقدر امن است؟",
    answer:
      "داده‌های شما به حساب کاربری‌تان وابسته است و فقط پس از ورود در دسترس قرار می‌گیرد. رمز عبور هرگز به‌صورت خام ذخیره نمی‌شود و صفحات مالی در حافظه آفلاین مرورگر ذخیره نمی‌شوند. جزئیات بیشتر را در صفحه حریم خصوصی بخوانید.",
  },
  {
    question: "آیا می‌توانم چند نوع دارایی مختلف (ملک، طلا، ارز دیجیتال...) اضافه کنم؟",
    answer:
      "بله؛ حساب بانکی و کیف پول، ملک، خودرو، طلا و کالا، سرمایه‌گذاری و ارز دیجیتال — همه در یک‌جا ثبت و ارزش‌گذاری می‌شوند.",
  },
];

function CtaCluster({ align = "start" }: { align?: "start" | "center" }) {
  return (
    <div className={align === "center" ? "landing-cta-cluster landing-cta-cluster-center" : "landing-cta-cluster"}>
      <Link href="/register" className="btn btn-primary !min-h-12 w-full sm:w-auto sm:px-6">
        شروع رایگان
      </Link>
      <Link href="/login" className="btn btn-ghost !min-h-12 w-full sm:w-auto sm:px-6">
        ورود
      </Link>
    </div>
  );
}

function ProductPreview() {
  return (
    <figure
      className="landing-preview"
      aria-label="نمونه نمایشی از ارزش خالص، دارایی‌ها، بدهی‌ها و نقدینگی به تومان"
    >
      <figcaption className="muted px-[0.9rem] pb-1.5 pt-2.5 text-[12px] font-medium">
        یک نمونه واقعی از داشبورد توازن:
      </figcaption>
      <div className="landing-preview-chrome">
        <div className="landing-preview-dots" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
        <p className="landing-preview-badge">نمونه نمایشی</p>
      </div>
      <div className="landing-preview-body">
        <p className="muted text-[11px] font-medium">ارزش خالص</p>
        <p className="display-num landing-preview-hero-amount">{PREVIEW_SAMPLE.netWorth}</p>
        <div className="landing-preview-metrics">
          <div>
            <p className="muted text-[10.5px]">دارایی‌ها</p>
            <p className="display-num landing-preview-amount">{PREVIEW_SAMPLE.assets}</p>
          </div>
          <div>
            <p className="muted text-[10.5px]">بدهی‌ها</p>
            <p className="display-num landing-preview-amount">{PREVIEW_SAMPLE.debts}</p>
          </div>
          <div>
            <p className="muted text-[10.5px]">نقدینگی</p>
            <p className="display-num landing-preview-amount">{PREVIEW_SAMPLE.liquidity}</p>
          </div>
        </div>
        <div className="comp-bar mt-4" aria-hidden="true">
          <span style={{ width: "42%", background: "var(--color-module-wealth)" }} />
          <span style={{ width: "28%", background: "var(--color-module-expenses)" }} />
          <span style={{ width: "18%", background: "var(--color-primary)" }} />
          <span style={{ width: "12%", background: "var(--color-module-commitments)" }} />
        </div>
      </div>
    </figure>
  );
}

function FaqAccordion() {
  return (
    <div className="mx-auto mt-1 flex w-full max-w-2xl flex-col gap-2.5">
      {FAQ_ITEMS.map((item) => (
        <details key={item.question} className="card group overflow-hidden">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3.5 marker:hidden [&::-webkit-details-marker]:hidden">
            <span className="text-[13.5px] font-semibold">{item.question}</span>
            <span className="muted shrink-0 transition-transform group-open:rotate-180" aria-hidden="true">
              <Icon name="chevronDown" size={15} />
            </span>
          </summary>
          <div className="border-t p-4" style={{ borderColor: "var(--border)" }}>
            <p className="sub text-[13px] leading-6">{item.answer}</p>
          </div>
        </details>
      ))}
    </div>
  );
}

export default function LandingPage() {
  return (
    <div className="landing">
      <LandingHeader />

      <div className="landing-hero-band">
        <section className="landing-wrap landing-hero">
          <div className="landing-hero-copy">
            <p className="landing-kicker">سیستم‌عامل ثروت شخصی</p>
            <h1 className="landing-display">تمام ثروت شما، یک تصویر روشن.</h1>
            <p className="landing-lede">
              دیگر لازم نیست بین اکسل، اپلیکیشن بانک و یادداشت‌های پراکنده سرگردان باشید. توازن دارایی‌ها، بدهی‌ها،
              نقدینگی و ارزش خالص شما را در یک داشبورد ساده کنار هم می‌چیند تا با اطمینان بیشتری تصمیم بگیرید.
            </p>
            <CtaCluster />
            <p className="landing-hero-note">بدون نیاز به اتصال حساب بانکی</p>
          </div>
          <ProductPreview />
        </section>
      </div>

      <section className="landing-band-surface">
        <div className="landing-wrap landing-section" aria-labelledby="outcomes-title">
          <h2 id="outcomes-title" className="landing-h2">
            هر عدد، یک تصمیم بهتر.
          </h2>
          <div className="landing-outcomes">
            {OUTCOMES.map((item) => (
              <article key={item.title} className="landing-benefit">
                <span className={`landing-icon landing-icon-${item.tone}`}>
                  <Icon name={item.icon} size={18} />
                </span>
                <div>
                  <h3 className="text-[15px] font-semibold">{item.title}</h3>
                  <p className="sub mt-0.5 text-[13px] leading-6">{item.body}</p>
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="landing-band">
        <div className="landing-wrap landing-section" aria-labelledby="steps-title">
          <h2 id="steps-title" className="landing-h2">
            شروع، ساده‌تر از یک صفحه‌گسترده.
          </h2>
          <div className="landing-outcomes">
            {STEPS.map((item) => (
              <article key={item.title} className="landing-benefit">
                <span className="landing-icon">
                  <Icon name={item.icon} size={18} />
                </span>
                <div>
                  <h3 className="text-[15px] font-semibold">{item.title}</h3>
                  <p className="sub mt-0.5 text-[13px] leading-6">{item.body}</p>
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="landing-band">
        <div className="landing-wrap landing-section" aria-labelledby="trust-title">
          <h2 id="trust-title" className="landing-h2">
            خصوصی، شفاف، تحت کنترل شما.
          </h2>
          <p className="landing-support">
            اطلاعات مالی شما فقط برای خودتان است. داده‌های شما محرمانه می‌ماند و هرگز با شخص ثالثی به اشتراک گذاشته یا
            فروخته نمی‌شود. توازن نیازی به اتصال مستقیم حساب بانکی ندارد — شما همیشه کنترل کامل روی داده‌های خود دارید.
          </p>
          <p className="landing-support landing-trust-links">
            <Link href="/privacy" className="font-medium" style={{ color: "var(--color-primary)" }}>
              حریم خصوصی
            </Link>
            <span className="muted" aria-hidden="true">
              ·
            </span>
            <Link href="/about" className="font-medium" style={{ color: "var(--color-primary)" }}>
              درباره توازن
            </Link>
          </p>
        </div>
      </section>

      <section className="landing-band">
        <div className="landing-wrap landing-section" aria-labelledby="faq-title">
          <h2 id="faq-title" className="landing-h2">
            سوالات متداول
          </h2>
          <FaqAccordion />
        </div>
      </section>

      <section className="landing-band-surface">
        <div className="landing-wrap landing-section" aria-labelledby="final-cta-title">
          <div className="landing-cta-final">
            <h2 id="final-cta-title" className="landing-h2">
              همین امروز تصویر مالی‌تان را روشن کنید.
            </h2>
            <p className="landing-support mx-auto">ثبت‌نام ساده است و نیازی به کارت بانکی ندارد.</p>
            <CtaCluster align="center" />
          </div>
        </div>
      </section>

      <LandingFooter />
    </div>
  );
}
