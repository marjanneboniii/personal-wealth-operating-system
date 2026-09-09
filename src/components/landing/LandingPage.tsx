import Link from "next/link";
import AnimatedAmount from "@/components/landing/AnimatedAmount";
import LandingAmbience from "@/components/landing/LandingAmbience";
import { LandingFooter, LandingHeader } from "@/components/landing/LandingChrome";
import Icon, { type IconName } from "@/components/ui/Icon";

/**
 * DEMO DATA — ONLY for the public landing page preview.
 * These are fictional but consistent numbers (assets − debts = net worth).
 * Real users enter their own data after login/registration.
 * This data is NEVER used inside the app for any user.
 */
const PREVIEW_SAMPLE = {
  netWorth: "۱۲۵٬۰۰۰٬۰۰۰ تومان",
  assets: "۱۸۰٬۰۰۰٬۰۰۰ تومان",
  debts: "۵۵٬۰۰۰٬۰۰۰ تومان",
  liquidity: "۳۵٬۰۰۰٬۰۰۰ تومان",
} as const;

/**
 * `tone` is a presentation key only — it selects the semantic accent of the
 * card icon and carries no financial meaning of its own:
 *   wealth      → sky/cyan, the primary interactive accent
 *   invest      → pale lavender, the restrained investment-only accent
 *   commitments → amber, financial obligations that need attention
 *   liquidity   → emerald, positive/available money
 */
const OUTCOMES: { icon: IconName; title: string; body: string; tone: "wealth" | "invest" | "commitments" | "liquidity" }[] = [
  { icon: "networth", title: "ارزش خالص", body: "بدانید امسال واقعاً ثروتمندتر شده‌اید یا نه.", tone: "wealth" },
  { icon: "portfolio", title: "دارایی‌ها", body: "از حساب بانکی تا ملک و طلا، همه‌جا یک‌جا.", tone: "invest" },
  { icon: "debts", title: "بدهی‌ها", body: "هیچ قسط یا بدهی‌ای از چشمتان دور نمی‌ماند.", tone: "commitments" },
  { icon: "wallet", title: "نقدینگی", body: "همین امروز بدانید چقدر پول واقعی در دست دارید.", tone: "liquidity" },
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
      "بله؛ حساب بانکی و کیف پول، ملک، خودرو، طلا، سرمایه‌گذاری و ارز دیجیتال — همه در یک‌جا ثبت و ارزش‌گذاری می‌شوند. قیمت کالاهای مصرفی هم در «ردیاب تورم شخصی» جداگانه دنبال می‌شود و جزو دارایی‌ها حساب نمی‌شود.",
  },
];

function CtaCluster({ align = "start" }: { align?: "start" | "center" }) {
  return (
    <div className={align === "center" ? "landing-cta-cluster landing-cta-cluster-center" : "landing-cta-cluster"}>
      <Link href="/register" className="btn btn-primary !min-h-12 w-full sm:w-auto sm:px-6">
        شروع رایگان
      </Link>
      {/* «ورود» stays visually secondary next to the single primary CTA. */}
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
      <div className="landing-preview-chrome">
        <div className="landing-preview-dots" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
        <p className="landing-preview-badge">نمونه نمایشی</p>
      </div>
      <div className="landing-preview-body">
        <figcaption className="landing-preview-label">یک نمونه واقعی از داشبورد توازن:</figcaption>
        <p className="landing-preview-label mt-3">ارزش خالص</p>
        <p className="display-num landing-preview-hero-amount">
          <AnimatedAmount value={PREVIEW_SAMPLE.netWorth} />
        </p>
        <div className="landing-preview-metrics">
          <div className="landing-preview-metric landing-preview-metric-assets">
            <p className="landing-preview-label">دارایی‌ها</p>
            <p className="display-num landing-preview-amount">
              <AnimatedAmount value={PREVIEW_SAMPLE.assets} />
            </p>
          </div>
          <div className="landing-preview-metric landing-preview-metric-debts">
            <p className="landing-preview-label">بدهی‌ها</p>
            <p className="display-num landing-preview-amount">
              <AnimatedAmount value={PREVIEW_SAMPLE.debts} />
            </p>
          </div>
          <div className="landing-preview-metric landing-preview-metric-liquidity">
            <p className="landing-preview-label">نقدینگی</p>
            <p className="display-num landing-preview-amount">
              <AnimatedAmount value={PREVIEW_SAMPLE.liquidity} />
            </p>
          </div>
        </div>
        <div className="comp-bar" aria-hidden="true">
          <span style={{ width: "42%", background: "var(--l-accent)" }} />
          <span style={{ width: "28%", background: "var(--l-positive)" }} />
          <span style={{ width: "18%", background: "var(--l-investment)" }} />
          <span style={{ width: "12%", background: "var(--l-negative)" }} />
        </div>
      </div>
    </figure>
  );
}

function FaqAccordion() {
  return (
    <div className="landing-faq">
      {FAQ_ITEMS.map((item) => (
        <details key={item.question} className="landing-faq-item">
          <summary>
            <span>{item.question}</span>
            {/* Non-directional in RTL: the chevron rotates, it never mirrors. */}
            <span className="landing-faq-chevron" aria-hidden="true">
              <Icon name="chevronDown" size={16} />
            </span>
          </summary>
          <div className="landing-faq-answer">{item.answer}</div>
        </details>
      ))}
    </div>
  );
}

export default function LandingPage() {
  return (
    <div className="landing">
      <LandingHeader />

      <div className="landing-hero-band landing-ink">
        <LandingAmbience />
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
          <div className="landing-outcomes landing-outcomes-4">
            {OUTCOMES.map((item) => (
              <article key={item.title} className="landing-benefit">
                <span className={`landing-icon landing-icon-${item.tone}`} aria-hidden="true">
                  <Icon name={item.icon} size={18} />
                </span>
                <div className="min-w-0">
                  <h3 className="landing-benefit-title">{item.title}</h3>
                  <p className="landing-benefit-body">{item.body}</p>
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
                <span className="landing-step-index" aria-hidden="true">
                  <Icon name={item.icon} size={18} />
                </span>
                <div className="min-w-0">
                  <h3 className="landing-benefit-title">{item.title}</h3>
                  <p className="landing-benefit-body">{item.body}</p>
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="landing-band-surface">
        <div className="landing-wrap landing-section" aria-labelledby="trust-title">
          <h2 id="trust-title" className="landing-h2">
            خصوصی، شفاف، تحت کنترل شما.
          </h2>
          <p className="landing-support">
            اطلاعات مالی شما فقط برای خودتان است. داده‌های شما محرمانه می‌ماند و هرگز با شخص ثالثی به اشتراک گذاشته یا
            فروخته نمی‌شود. توازن نیازی به اتصال مستقیم حساب بانکی ندارد — شما همیشه کنترل کامل روی داده‌های خود دارید.
          </p>
          <p className="landing-support landing-trust-links">
            <Link href="/privacy" className="font-medium">
              حریم خصوصی
            </Link>
            <span className="muted" aria-hidden="true">
              ·
            </span>
            <Link href="/about" className="font-medium">
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

      <section className="landing-band">
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
