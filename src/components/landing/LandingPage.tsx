import type { ReactNode } from "react";
import Image from "next/image";
import Link from "next/link";
import ProductFilms from "@/components/landing/ProductFilms";
import AnimatedAmount from "@/components/landing/AnimatedAmount";
import LandingAmbience from "@/components/landing/LandingAmbience";
import CoverageField, { type CoverageKind } from "@/components/landing/CoverageField";
import { LandingFooter, LandingHeader } from "@/components/landing/LandingChrome";
import Icon, { type IconName } from "@/components/ui/Icon";
import { SETUP_BANKS } from "@/features/setup/bankCatalog";
import { KNOWN_WALLETS } from "@/features/setup/holdingWallets";
import { FUND_CATALOG } from "@/features/funds/catalogData";
import { faCount } from "@/lib/format";

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
 * Composition of the demo net worth. The widths are the segments of the
 * `comp-bar`, and the SAME array renders the legend beneath it — so a reader
 * can tell which colour is which instead of looking at four anonymous stripes.
 *
 * The colours are the landing's category palette — the SAME hue each kind wears
 * on its chip in the band below, so «طلا is amber» is learned once and holds
 * everywhere on the page. They are deliberately NOT --positive and --negative:
 * in this product green and red mean money coming IN and going OUT, and once
 * the legend names the stripes, a red one would tell a first-time visitor that
 * holding crypto is a loss. `var` names, not literal colours, so the bar
 * re-themes with the rest of the page.
 */
const PREVIEW_MIX: { label: string; pct: number; color: string }[] = [
  { label: "ملک", pct: 42, color: "var(--lc-property-ink)" },
  { label: "نقد و سپرده", pct: 28, color: "var(--lc-cash-ink)" },
  { label: "طلا", pct: 18, color: "var(--lc-gold-ink)" },
  { label: "رمزارز", pct: 12, color: "var(--lc-crypto-ink)" },
];

/**
 * How setup actually works — selection first. The visitor's real worry is
 * "how much typing is this?", and the honest answer is: pick your banks,
 * exchanges and holdings from lists the product already knows, then type
 * today's balance. `tone` is the landing's category palette (presentation only).
 */
const SETUP_STEPS: { icon: IconName; title: string; body: string; tone: string }[] = [
  {
    icon: "accounts",
    title: "بانک‌ها و صرافی‌هایتان",
    body: "بانک‌هایی که در آن‌ها حساب دارید، صرافی‌های داخلی و خارجی و کیف پول‌های رمزارز را از فهرست انتخاب کنید و موجودی امروز هر کدام را بنویسید.",
    tone: "bank",
  },
  {
    icon: "portfolio",
    title: "سرمایه‌گذاری‌ها و دارایی‌ها",
    body: "طلای آب‌شدهٔ آنلاین، صندوق‌های طلا، درآمد ثابت و سهامی، سهام بورس و فرابورس، ملک و خودرو؛ هر کدام را دارید علامت بزنید.",
    tone: "invest",
  },
  {
    icon: "installments",
    title: "وام‌ها و بدهی‌ها",
    body: "وام بانکی، قرض یا خرید قسطی را با مانده و برنامهٔ اقساطش اضافه کنید. از همان روز اول، تصویر واقعی را می‌بینید.",
    tone: "debt",
  },
];

/**
 * What setup already knows, counted from the very lists the setup wizard
 * offers — never typed by hand, so the landing can't overstate the catalogue
 * as it grows or shrinks.
 */
const CATALOG_STATS: { value: number; label: string }[] = [
  { value: SETUP_BANKS.length, label: "بانک و مؤسسهٔ مالی" },
  { value: KNOWN_WALLETS.filter((w) => w.kind === "exchange").length, label: "صرافی داخلی و خارجی" },
  { value: KNOWN_WALLETS.filter((w) => w.kind === "broker").length, label: "کارگزاری بورس" },
  { value: KNOWN_WALLETS.filter((w) => w.kind === "hot" || w.kind === "cold").length, label: "کیف پول رمزارز" },
  { value: FUND_CATALOG.length, label: "صندوق سرمایه‌گذاری" },
];

/** The same institutions, as the logos the setup pick lists show. */
const CATALOG_LOGOS: { name: string; logo: string }[] = [
  ...SETUP_BANKS.map(({ name, logo }) => ({ name, logo })),
  ...KNOWN_WALLETS.filter((w) => w.kind !== "hot" && w.kind !== "cold" && w.logo).map((w) => ({ name: w.name, logo: w.logo! })),
];

/**
 * Everything the product actually contains, in the product's own words — the
 * labels and questions come from the real navigation (src/lib/nav.ts), so this
 * grid promises nothing that a registered visitor will not find.
 *
 * `wide` is a bento hint only: the first tile carries the paragraph that frames
 * the rest, so it gets two columns on a wide screen.
 */
const MODULES: { icon: IconName; title: string; body: string; tone: string; wide?: boolean }[] = [
  {
    icon: "cashflow",
    title: "پول کجا می‌رود",
    body: "هر ماه چقدر وارد شده و چقدر خرج شده، دسته‌بندی‌شده و قابل‌مقایسه با ماه‌های قبل.",
    tone: "flow",
    wide: true,
  },
  { icon: "budgets", title: "سقف خرج", body: "برای هر دسته یک حد بگذارید و ببینید کجا از آن رد شده‌اید.", tone: "budget" },
  { icon: "goals", title: "پس‌انداز و هدف", body: "برای خانه، سفر یا روز مبادا کنار بگذارید و پیشرفتش را ببینید.", tone: "goal" },
  { icon: "installments", title: "وام و قسط", body: "هر قسط کِی سررسید می‌شود، از هر وام چقدر مانده.", tone: "debt" },
  { icon: "pie", title: "سرمایه‌گذاری و قیمت روز", body: "چه چیزهایی خریده‌اید، و طلا و ارز و سهام امروز چند است.", tone: "invest" },
  { icon: "scale", title: "گرانی سبد خودتان", body: "قیمت چیزهایی که خودتان می‌خرید را ثبت کنید و ببینید چقدر گران شده.", tone: "inflation" },
  { icon: "networth", title: "رشد دارایی در طول زمان", body: "امسال نسبت به پارسال جلو رفته‌اید یا عقب.", tone: "wealth" },
  {
    icon: "reports",
    title: "گزارش و هشدار",
    body: "خلاصهٔ دوره‌ای، نکته‌هایی که سیستم در اعداد شما می‌بیند، و تصویر ماه‌های پیشِ رو.",
    tone: "report",
  },
];

/**
 * The differentiators — the four things that are true of THIS product and not
 * of a spreadsheet or a generic expense tracker. Each one is verifiable inside
 * the app, which is why none of them is a superlative.
 */
const DIFFERENTIATORS: { icon: IconName; title: string; body: string; tone: string }[] = [
  {
    icon: "check",
    title: "جمع‌ها همیشه درست درمی‌آید",
    body: "در یک فایل اکسل، یک فرمول اشتباه می‌تواند ماه‌ها بی‌سروصدا عدد غلط بدهد. اینجا هر مبلغی که جابه‌جا می‌شود سر جای دیگری می‌نشیند، پس چیزی گم نمی‌شود.",
    tone: "flow",
  },
  {
    icon: "globe",
    title: "می‌فهمید رشد واقعی بوده یا نه",
    body: "وقتی همه‌چیز گران می‌شود، عددها هم بزرگ می‌شوند. توازن کنارِ تومان، معادل دلاری را هم نشان می‌دهد تا معلوم شود واقعاً جلو رفته‌اید یا فقط عددها بزرگ شده‌اند.",
    tone: "invest",
  },
  {
    icon: "receipt",
    title: "گرانی را با قیمت‌های خودتان می‌سنجید",
    body: "عدد رسمی تورم، سبد خرید شما نیست. قیمت چیزهایی را که واقعاً می‌خرید وارد کنید تا ببینید زندگی خودتان چقدر گران شده.",
    tone: "inflation",
  },
  {
    icon: "phone",
    title: "روی گوشی مثل یک اپ",
    body: "توازن را روی صفحهٔ گوشی اضافه کنید و بدون رفتن به فروشگاه اپلیکیشن، تمام‌صفحه و سریع بازش کنید.",
    tone: "goal",
  },
];

/** The promises made in the trust band — short enough to read in one pass. */
const TRUST_POINTS: { icon: IconName; title: string; body: string }[] = [
  {
    icon: "ledger",
    title: "فقط ثبت می‌کند، پول جابه‌جا نمی‌کند",
    body: "توازن دفتر حساب شماست، نه درگاه پرداخت. هر عددی که می‌بینید را خودتان ثبت یا تأیید کرده‌اید و هیچ تراکنشی بدون تأیید شما ثبت نمی‌شود.",
  },
  {
    icon: "shield",
    title: "نه فروخته می‌شود، نه تبلیغ",
    body: "توازن مدل درآمدی‌اش را روی دادهٔ مالی شما نبسته است؛ اطلاعاتتان با هیچ‌کس به اشتراک گذاشته نمی‌شود.",
  },
  {
    icon: "download",
    title: "خروجی همیشه دست شماست",
    body: "می‌توانید از داده‌هایتان نسخهٔ پشتیبان بگیرید؛ چیزی شما را در محصول حبس نمی‌کند.",
  },
];

/*
 * Every question that was here is still here — none was dropped. What changed
 * is that each one now answers the worry BEHIND the question (cost, effort,
 * safety, coverage) instead of stopping at a one-word yes/no, and five more
 * questions were added for the things a first-time visitor actually stalls on:
 * how long setup takes, phones, currencies, who this is not for, and leaving.
 *
 * Answers are ReactNode, so a reference to another page is a real link.
 */
const FAQ_ITEMS: { question: string; answer: ReactNode }[] = [
  {
    question: "آیا استفاده از توازن رایگان است؟",
    answer:
      "بله. برای شروع فقط یک حساب کاربری لازم است — بدون دورهٔ آزمایشی و بدون قفل‌شدن امکانات بعد از چند روز.",
  },
  {
    question: "شروع کار چقدر طول می‌کشد؟",
    answer:
      "چند دقیقه. بانک‌ها، صرافی‌ها و دارایی‌هایتان را از فهرست انتخاب می‌کنید و موجودی امروز هر کدام را می‌نویسید. هر چه جا ماند را بعداً هم می‌توانید اضافه کنید.",
  },
  {
    question: "آیا باید حساب بانکی‌ام را وصل کنم؟",
    answer:
      "نه. توازن به بانک وصل نمی‌شود و رمز یا دسترسی نمی‌خواهد؛ بانک را فقط از فهرست انتخاب می‌کنید. اگر بخواهید ثبت خرج‌ها سریع‌تر شود، روی آیفون می‌توانید پیامک‌های بانک را با یک میان‌بُر به توازن بفرستید. هر پیامک به یک تراکنش پیشنهادی تبدیل می‌شود و تا تأییدش نکنید، چیزی ثبت نمی‌شود.",
  },
  {
    question: "ثبت اطلاعات چقدر کار می‌برد؟",
    answer:
      "ثبت روزمره چند ثانیه بیشتر نیست، و دارایی‌های ثابت مثل ملک یا خودرو را فقط یک‌بار وارد می‌کنید و بعد هر چند وقت یک‌بار ارزش‌شان را به‌روز می‌کنید.",
  },
  {
    question: "اطلاعات مالی من کجا ذخیره می‌شود و چقدر امن است؟",
    answer: (
      <>
        داده‌های شما روی سرور توازن و مقیّد به حساب کاربری خودتان ذخیره می‌شود؛ بدون ورود، هیچ‌کس به آن
        دسترسی ندارد. رمز عبور هرگز به‌صورت قابل‌خواندن نگهداری نمی‌شود، و صفحه‌های مالی روی دستگاه شما
        ذخیره نمی‌شوند تا بعد از خروج، چیزی از حساب شما روی آن دستگاه باقی نماند. جزئیات کامل در{" "}
        <Link href="/privacy">صفحه حریم خصوصی</Link> آمده است.
      </>
    ),
  },
  {
    question: "آیا می‌توانم انواع دارایی را کنار هم داشته باشم — ملک، طلا، رمزارز؟",
    answer: (
      <>
        بله. حساب‌های بانکی، تومان و رمزارزِ صرافی‌ها و کیف پول‌ها، طلای آب‌شده، صندوق‌ها، سهام بورس و
        فرابورس، ملک و خودرو همه کنار هم ثبت می‌شوند و بعد از کم‌شدن بدهی‌ها، در یک عدد جمع می‌آیند. قیمت کالاهای مصرفی جدا در «ردیاب تورم شخصی»
        دنبال می‌شود و جزو دارایی‌ها حساب نمی‌شود.
      </>
    ),
  },
  {
    question: "برای چه کسی مناسب نیست؟",
    answer: (
      <>
        اگر دنبال یک اپ صرفاً ثبت هزینهٔ روزانه هستید، توازن بیش از نیاز شماست. این محصول برای کسی ساخته
        شده که دارایی و بدهی متنوع دارد و می‌خواهد تصویر کلی ثروتش را دقیق و آرام ببیند. توضیح بیشتر در{" "}
        <Link href="/about">درباره توازن</Link>.
      </>
    ),
  },
  {
    question: "اگر بخواهم بروم، داده‌هایم چه می‌شود؟",
    answer:
      "می‌توانید از اطلاعاتتان نسخهٔ پشتیبان بگیرید و حسابتان را ببندید. داده‌ها متعلق به شماست و چیزی شما را در محصول نگه نمی‌دارد.",
  },
];

/**
 * The asset vocabulary, with the icon each kind actually carries inside the
 * app. This replaced a decorative orbit ring: the ring only existed above
 * 1100px, so on a phone — the device most visitors arrive with — the fastest
 * answer to "does this cover what I own?" was invisible. A single hairline
 * strip shows the same words on every screen and costs no absolute positioning.
 */
const COVERAGE: CoverageKind[] = [
  { icon: "accounts", label: "حساب بانکی", tone: "bank" },
  { icon: "wallet", label: "صرافی و کیف پول", tone: "cash" },
  { icon: "crypto", label: "رمزارز", tone: "crypto" },
  { icon: "coins", label: "طلای آب‌شده", tone: "gold" },
  { icon: "pie", label: "صندوق سرمایه‌گذاری", tone: "invest" },
  { icon: "portfolio", label: "سهام بورس و فرابورس", tone: "stock" },
  { icon: "home", label: "ملک", tone: "property" },
  { icon: "car", label: "خودرو", tone: "vehicle" },
  { icon: "installments", label: "وام و قسط", tone: "debt" },
];

function CtaCluster({ align = "start" }: { align?: "start" | "center" }) {
  return (
    <div className={align === "center" ? "landing-cta-cluster landing-cta-cluster-center" : "landing-cta-cluster"}>
      {/* `w-full` is gone: the cluster is a row at every width now, and the
          primary grows into whatever space is left (see .landing-cta-cluster). */}
      <Link href="/register" className="btn btn-primary !min-h-12 sm:px-6">
        شروع رایگان
      </Link>
      {/* «ورود» stays visually secondary next to the single primary CTA. */}
      <Link href="/login" className="btn btn-ghost !min-h-12 px-4 sm:px-6">
        ورود
      </Link>
    </div>
  );
}

/**
 * Decorative trend line behind the preview's hero figure. It is drawn from a
 * fixed point list — it is NOT derived from the demo numbers and must never be
 * read as data, which is why it carries no axis, no labels and aria-hidden.
 */
function PreviewSparkline() {
  return (
    <svg className="landing-preview-spark" viewBox="0 0 240 56" preserveAspectRatio="none" aria-hidden="true">
      <defs>
        <linearGradient id="landing-spark-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--positive)" stopOpacity="0.20" />
          <stop offset="100%" stopColor="var(--positive)" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path
        d="M0 46 L30 42 L60 44 L90 34 L120 36 L150 26 L180 22 L210 14 L240 8 L240 56 L0 56 Z"
        fill="url(#landing-spark-fill)"
      />
      <path
        d="M0 46 L30 42 L60 44 L90 34 L120 36 L150 26 L180 22 L210 14 L240 8"
        fill="none"
        stroke="var(--positive)"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
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
        <figcaption className="landing-preview-label landing-preview-caption">نمایی از داشبورد توازن</figcaption>
        <div className="landing-preview-hero">
          <div className="landing-preview-hero-text">
            <p className="landing-preview-label">ارزش خالص</p>
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
          </div>
          <PreviewSparkline />
        </div>
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
        <div className="landing-preview-mix">
          <div className="comp-bar" aria-hidden="true">
            {PREVIEW_MIX.map((slice) => (
              <span key={slice.label} style={{ width: `${slice.pct}%`, background: slice.color }} />
            ))}
          </div>
          {/* A legend, because four anonymous stripes say nothing. The same
              array drives both, so a width can never drift from its label. */}
          <ul className="landing-preview-legend">
            {PREVIEW_MIX.map((slice) => (
              <li key={slice.label}>
                <span className="landing-preview-swatch" style={{ background: slice.color }} aria-hidden="true" />
                <span>{slice.label}</span>
              </li>
            ))}
          </ul>
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
            <p className="landing-kicker">
              <span className="landing-kicker-dot" aria-hidden="true" />
              برای وقتی که پولتان در چند جا پخش است
            </p>
            <h1 className="landing-display">همهٔ پول و دارایی‌تان، در یک صفحه.</h1>
            <p className="landing-lede">
              حساب بانکی، صرافی و کیف پول رمزارز، طلای آنلاین، صندوق و سهام، ملک و خودرو، و همهٔ وام‌ها و قسط‌ها.
              توازن همه را کنار هم می‌گذارد و می‌گوید بعد از کم‌کردن بدهی‌ها، واقعاً چقدر دارید.
            </p>
            <CtaCluster />
            <Link href="#product-tour" className="landing-watch-demo">دیدن توازن در ۲۰ ثانیه<Icon name="arrow-start" size={18} /></Link>
            {/* Three claims the visitor can check, not a slogan. */}
            <ul className="landing-hero-proof">
              <li>
                <Icon name="check" size={14} />
                رایگان برای شروع
              </li>
              <li>
                <Icon name="check" size={14} />
                راه‌اندازی با چند انتخاب
              </li>
              <li>
                <Icon name="check" size={14} />
                روی گوشی و کامپیوتر
              </li>
            </ul>
          </div>
          <div className="landing-hero-visual">
            <ProductPreview />
          </div>
        </section>

        {/* The band that closes the hero. It is the last thing read before the
            fold, and the only moving thing on the page — deliberately below the
            copy, never behind it, so no motion can ever sit under a sentence. */}
        <div className="landing-coverage">
          <div className="landing-wrap">
            <p className="landing-coverage-caption">هر چه دارید، جایش اینجاست</p>
            <CoverageField kinds={COVERAGE} />
          </div>
        </div>
      </div>

      <ProductFilms />

      <section className="landing-band" id="setup">
        <div className="landing-wrap landing-section" aria-labelledby="setup-title">
          <p className="landing-eyebrow">راه‌اندازی</p>
          <h2 id="setup-title" className="landing-h2">
            به‌جای فرم پر کردن، فقط انتخاب می‌کنید.{" "}
            <span className="landing-h2-quiet">بانک، صرافی، کارگزاری و صندوق را توازن از قبل می‌شناسد.</span>
          </h2>
          <p className="landing-support">علامت می‌زنید چه دارید و موجودی امروزش را می‌نویسید؛ همین.</p>
          <ul className="landing-stats" aria-label="آنچه توازن از قبل می‌شناسد">
            {CATALOG_STATS.map((stat) => (
              <li key={stat.label} className="landing-stat">
                <span className="landing-stat-value">{faCount(stat.value)}</span>
                <span className="landing-stat-label">{stat.label}</span>
              </li>
            ))}
          </ul>
          {/* Logo wall: drifts on wide screens, a still strip under reduced motion.
              The second copy only closes the loop, so assistive tech skips it. */}
          <div className="landing-logos">
            <div className="landing-logos-track">
              {[0, 1].map((copy) => (
                <ul key={copy} className="landing-logos-row" aria-hidden={copy === 1 || undefined} aria-label={copy === 0 ? "بانک‌ها، صرافی‌ها و کارگزاری‌های فهرست راه‌اندازی" : undefined}>
                  {CATALOG_LOGOS.map((item) => (
                    <li key={item.logo + item.name} title={item.name}>
                      <Image src={item.logo} alt={copy === 0 ? item.name : ""} width={36} height={36} loading="lazy" unoptimized />
                    </li>
                  ))}
                </ul>
              ))}
            </div>
          </div>
          <p className="landing-logos-note">نام‌ها و نشان‌ها متعلق به صاحبانشان است و به معنای همکاری رسمی نیست.</p>
          <ol className="landing-steps">
            {SETUP_STEPS.map((item, index) => (
              <li key={item.title} className="landing-diff landing-reveal" data-tone={item.tone}>
                <div className="landing-step-head">
                  <span className="landing-diff-icon" aria-hidden="true">
                    <Icon name={item.icon} size={18} />
                  </span>
                  <span className="landing-step-num" aria-hidden="true">{"۱۲۳"[index]}</span>
                </div>
                <h3 className="landing-diff-title">{item.title}</h3>
                <p className="landing-benefit-body">{item.body}</p>
              </li>
            ))}
          </ol>
          {/* Optional, and said so: the SMS bridge is an iPhone-only extra, never a requirement. */}
          <aside className="landing-diff landing-sms landing-reveal" data-tone="flow" aria-labelledby="sms-title">
            <span className="landing-diff-icon" aria-hidden="true">
              <Icon name="phone" size={18} />
            </span>
            <div className="min-w-0">
              <h3 id="sms-title" className="landing-diff-title">
                اختیاری: پیامک‌های بانک، خودکار
              </h3>
              <p className="landing-benefit-body">
                روی آیفون، با یک میان‌بُر در برنامهٔ <bdi>Shortcuts</bdi>، پیامک‌های بانک به توازن می‌رسند و تراکنش
                پیشنهادی می‌سازند. فقط چند رقم آخر کارت یا حساب لازم است تا هر پیام به حساب درستش برسد، و تا خودتان
                تأیید نکنید هیچ موجودی‌ای تغییر نمی‌کند. اندروید فعلاً پشتیبانی نمی‌شود.
              </p>
            </div>
          </aside>
        </div>
      </section>

      <section className="landing-band" id="modules">
        <div className="landing-wrap landing-section" aria-labelledby="modules-title">
          <p className="landing-eyebrow">امکانات</p>
          <h2 id="modules-title" className="landing-h2">
            بعد از راه‌اندازی، هر روز به کارتان می‌آید.{" "}
            <span className="landing-h2-quiet">خرج ماه، قسط، هدف و سرمایه، کنار هم.</span>
          </h2>
          <div className="landing-bento">
            {MODULES.map((item) => (
              <article
                key={item.title}
                className={`landing-tile landing-reveal${item.wide ? " landing-tile-wide" : ""}`}
                data-tone={item.tone}
              >
                <span className="landing-tile-icon" aria-hidden="true">
                  <Icon name={item.icon} size={17} />
                </span>
                <h3 className="landing-tile-title">{item.title}</h3>
                <p className="landing-tile-body">{item.body}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="landing-band" id="why">
        <div className="landing-wrap landing-section" aria-labelledby="why-title">
          <p className="landing-eyebrow">تفاوت توازن</p>
          <h2 id="why-title" className="landing-h2">
            چهار چیزی که یک فایل اکسل به شما نمی‌دهد.{" "}
            <span className="landing-h2-quiet">و هر چهار تا را داخل محصول می‌توانید وارسی کنید.</span>
          </h2>
          <div className="landing-diffs">
            {DIFFERENTIATORS.map((item) => (
              <article key={item.title} className="landing-diff landing-reveal" data-tone={item.tone}>
                <span className="landing-diff-icon" aria-hidden="true">
                  <Icon name={item.icon} size={18} />
                </span>
                <h3 className="landing-diff-title">{item.title}</h3>
                <p className="landing-benefit-body">{item.body}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="landing-band-surface" id="security">
        <div className="landing-wrap landing-section" aria-labelledby="trust-title">
          <p className="landing-eyebrow">حریم خصوصی</p>
          <h2 id="trust-title" className="landing-h2">
            خصوصی، شفاف، تحت کنترل شما.
          </h2>
          <p className="landing-support">
            داده‌های مالی شما محرمانه می‌ماند و هرگز با کسی به اشتراک گذاشته یا فروخته نمی‌شود. کنترل کامل داده‌ها همیشه
            دست خودتان است.
          </p>
          <div className="landing-trust-grid">
            {TRUST_POINTS.map((item) => (
              <article key={item.title} className="landing-trust-card landing-reveal">
                <span className="landing-trust-icon" aria-hidden="true">
                  <Icon name={item.icon} size={17} />
                </span>
                <h3 className="landing-benefit-title">{item.title}</h3>
                <p className="landing-benefit-body">{item.body}</p>
              </article>
            ))}
          </div>
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

      <section className="landing-band" id="faq">
        <div className="landing-wrap landing-section" aria-labelledby="faq-title">
          <p className="landing-eyebrow">پیش از شروع</p>
          <h2 id="faq-title" className="landing-h2">
            سؤالات متداول
          </h2>
          <FaqAccordion />
        </div>
      </section>

      <section className="landing-band">
        <div className="landing-wrap landing-section" aria-labelledby="final-cta-title">
          <div className="landing-cta-final landing-ink">
            <h2 id="final-cta-title" className="landing-h2">
              همین امروز ببینید واقعاً چقدر دارید.
            </h2>
            <p className="landing-support mx-auto">ثبت‌نام رایگان است و راه‌اندازی چند دقیقه طول می‌کشد.</p>
            <CtaCluster align="center" />
          </div>
        </div>
      </section>

      <LandingFooter />

    </div>
  );
}
