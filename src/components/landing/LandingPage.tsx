import type { ReactNode } from "react";
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
  delta: "۴٬۲۰۰٬۰۰۰ تومان",
  // «۳.۵٪», never «(٪۳٫۵)». The app's own number standard (src/lib/format.ts)
  // puts ٪ AFTER the digits and uses an ASCII "." as the decimal mark — the
  // Persian ٫ is banned there because at small sizes it reads as a slash. The
  // landing is the first number a visitor ever sees from this product, so it
  // has to be written the way the product writes numbers.
  deltaPct: "۳.۵٪",
  deltaSince: "از ماه گذشته",
  netWorthUsd: "≈ ۱٬۴۵۳ دلار",
  attention: "قسط وام مسکن، ۳ روز دیگر",
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

/*
 * The steps deliberately carry a NUMBER, not an icon. With icons they rendered
 * as a third identical row of icon-and-text cards, so a visitor scrolling past
 * outcomes → steps saw the same block twice and read neither. A numeral also
 * says the thing the copy is trying to say — that this is a sequence.
 */
const STEPS: { title: string; body: string }[] = [
  {
    title: "دارایی‌ها و بدهی‌هایتان را اضافه کنید",
    body: "هر چیزی — حساب بانکی، ملک، طلا، سرمایه‌گذاری یا وام — را دستی اضافه کنید.",
  },
  {
    title: "توازن خودش حساب می‌کند",
    body: "ارزش خالص، نقدینگی و روند تغییرات با هر ثبت به‌روز می‌شود.",
  },
  {
    title: "با یک نگاه تصمیم بگیرید",
    body: "یک داشبورد واحد، بدون نیاز به فرمول‌نویسی یا محاسبه دستی.",
  },
];

/*
 * Every question and every fact here is kept. What changed is the SHAPE of the
 * answers: the security answer was one 40-word chain of semicolons that a
 * worried reader had to parse in a single breath, and its «صفحه حریم خصوصی»
 * pointed at a page without being a link to it. Answers are ReactNode now, so
 * that reference is the link it always claimed to be.
 */
const FAQ_ITEMS: { question: string; answer: ReactNode }[] = [
  {
    question: "آیا استفاده از توازن رایگان است؟",
    answer: "بله. برای شروع فقط یک حساب کاربری لازم است.",
  },
  {
    question: "آیا باید حساب بانکی‌ام را وصل کنم؟",
    answer:
      "خیر. توازن به هیچ حساب بانکی وصل نمی‌شود؛ دارایی‌ها و بدهی‌ها را خودتان وارد می‌کنید.",
  },
  {
    question: "اطلاعات مالی من کجا ذخیره می‌شود و چقدر امن است؟",
    answer: (
      <>
        داده‌های شما روی سرور توازن و مقیّد به حساب کاربری خودتان ذخیره می‌شود؛ بدون ورود، هیچ‌کس به آن
        دسترسی ندارد. رمز عبور هرگز به‌صورت قابل‌خواندن نگهداری نمی‌شود. صفحه‌های مالی هم در حافظه آفلاین
        مرورگر باقی نمی‌مانند. جزئیات کامل در{" "}
        <Link href="/privacy">صفحه حریم خصوصی</Link> آمده است.
      </>
    ),
  },
  {
    question: "آیا می‌توانم انواع دارایی را کنار هم داشته باشم — ملک، طلا، ارز دیجیتال؟",
    answer: (
      <>
        بله. حساب بانکی و کیف پول، ملک، خودرو، طلا، سرمایه‌گذاری و ارز دیجیتال، همه در یک‌جا ثبت و
        ارزش‌گذاری می‌شوند. قیمت کالاهای مصرفی جدا در «ردیاب تورم شخصی» دنبال می‌شود و جزو دارایی‌ها
        حساب نمی‌شود.
      </>
    ),
  },
];

/** Asset kinds the product covers — the same vocabulary the FAQ already uses. */
const ORBIT_CHIPS = ["حساب بانکی", "ملک", "طلا", "سرمایه‌گذاری", "ارز دیجیتال", "خودرو"];

/** Persian numerals for the steps. Three of them; a loop would cost more. */
const STEP_NUMERALS = ["۱", "۲", "۳"] as const;

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
        <figcaption className="landing-preview-label">نمایی از داشبورد توازن</figcaption>
        <p className="landing-preview-label mt-3">ارزش خالص</p>
        <p className="display-num landing-preview-hero-amount">
          <AnimatedAmount value={PREVIEW_SAMPLE.netWorth} />
        </p>
        {/* The delta and the ≈USD reference are what the real dashboard shows
            under the hero figure — without them the preview read like a
            different product. */}
        <p className="landing-preview-delta">
          <span aria-hidden="true">↑</span>
          <span className="num" dir="rtl">{PREVIEW_SAMPLE.delta}</span>
          <span className="num" dir="rtl">{PREVIEW_SAMPLE.deltaPct}</span>
          <span className="landing-preview-label">{PREVIEW_SAMPLE.deltaSince}</span>
        </p>
        <p className="landing-preview-label landing-preview-usd">
          <span className="num" dir="rtl">{PREVIEW_SAMPLE.netWorthUsd}</span>
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
        <div className="landing-preview-attention">
          <span className="landing-preview-attention-dot" aria-hidden="true" />
          <span>{PREVIEW_SAMPLE.attention}</span>
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
        /* `name` makes these a real accordion — opening one closes the others,
           natively, with no state and no script. */
        <details key={item.question} name="landing-faq" className="landing-faq-item landing-reveal">
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
          <div className="landing-orbit">
            {/*
              The orbiting chips are a desktop flourish — they need margin the
              phone layout does not have. But hiding the ring hid the WORDS, and
              «ملک · طلا · خودرو · ارز دیجیتال» is the fastest answer to "does
              this cover what I own?" — on the device most visitors arrive with.
              So below 1100px the same vocabulary returns as a plain wrapped row.
            */}
            <ul className="landing-kinds" aria-label="دارایی‌هایی که پوشش داده می‌شود">
              {ORBIT_CHIPS.map((label) => (
                <li key={label}>{label}</li>
              ))}
            </ul>
            <div className="landing-orbit-ring" aria-hidden="true">
              {ORBIT_CHIPS.map((label, i) => (
                <span key={label} className="landing-orbit-slot" style={{ ["--i" as string]: i }}>
                  <span className="landing-orbit-chip">{label}</span>
                </span>
              ))}
            </div>
            <ProductPreview />
          </div>
        </section>
      </div>

      <section className="landing-band-surface">
        <div className="landing-wrap landing-section" aria-labelledby="outcomes-title">
          <h2 id="outcomes-title" className="landing-h2">
            هر عدد، یک تصمیم بهتر.
          </h2>
          <div className="landing-outcomes landing-outcomes-4">
            {OUTCOMES.map((item) => (
              <article key={item.title} className="landing-benefit landing-reveal">
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
            شروع، ساده‌تر از یک فایل اکسل.
          </h2>
          <div className="landing-outcomes">
            {STEPS.map((item, i) => (
              <article key={item.title} className="landing-benefit landing-reveal">
                <span className="landing-step-index" aria-hidden="true">
                  {STEP_NUMERALS[i]}
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
            داده‌های مالی شما محرمانه می‌ماند و هرگز با کسی به اشتراک گذاشته یا فروخته نمی‌شود. کنترل کامل داده‌ها همیشه
            دست خودتان است.
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
            سؤالات متداول
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
