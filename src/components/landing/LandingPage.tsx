import Link from "next/link";
import { LandingFooter, LandingHeader } from "@/components/landing/LandingChrome";
import { DownloadIosButton } from "@/components/pwa/IosInstallGuide";
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

const OUTCOMES: { icon: IconName; title: string; body: string }[] = [
  { icon: "networth", title: "ارزش خالص", body: "ارزش واقعی ثروت شما پس از کسر بدهی‌ها." },
  { icon: "portfolio", title: "دارایی‌ها", body: "تمام دارایی‌های شما، در یک تصویر واحد." },
  { icon: "debts", title: "بدهی‌ها", body: "تمام تعهدات مالی شما، شفاف و در کنار دارایی‌ها." },
  { icon: "wallet", title: "نقدینگی", body: "آنچه امروز برای استفاده در دسترس شماست." },
];

function CtaCluster({ align = "start" }: { align?: "start" | "center" }) {
  return (
    <div className={align === "center" ? "landing-cta-cluster landing-cta-cluster-center" : "landing-cta-cluster"}>
      <Link href="/register" className="btn btn-primary !min-h-12 w-full sm:w-auto sm:px-6">
        ایجاد حساب
      </Link>
      <Link href="/login" className="btn !min-h-12 w-full sm:w-auto sm:px-6">
        ورود
      </Link>
      <DownloadIosButton className="!min-h-12 w-full sm:w-auto sm:px-5" variant="ghost" />
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
          <span style={{ width: "42%", background: "var(--asset-cash)" }} />
          <span style={{ width: "28%", background: "var(--asset-investment)" }} />
          <span style={{ width: "18%", background: "var(--asset-crypto)" }} />
          <span style={{ width: "12%", background: "var(--asset-other)" }} />
        </div>
      </div>
    </figure>
  );
}

export default function LandingPage() {
  return (
    <div className="landing">
      <LandingHeader />

      <section className="landing-wrap landing-hero">
        <div className="landing-hero-copy">
          <p className="landing-kicker">سیستم‌عامل ثروت شخصی</p>
          <h1 className="landing-display">تمام ثروت شما، یک تصویر روشن.</h1>
          <p className="landing-lede">
            دارایی‌ها، بدهی‌ها، نقدینگی و ارزش خالص خود را در یک نمای روشن ببینید و با اطمینان بیشتری
            تصمیم بگیرید.
          </p>
          <CtaCluster />
        </div>
        <ProductPreview />
      </section>

      <section className="landing-wrap landing-section" aria-labelledby="outcomes-title">
        <h2 id="outcomes-title" className="landing-h2">
          آنچه در یک نگاه می‌بینید
        </h2>
        <div className="landing-outcomes">
          {OUTCOMES.map((item) => (
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
      </section>

      <section className="landing-wrap landing-section" aria-labelledby="trust-title">
        <h2 id="trust-title" className="landing-h2">
          خصوصی، شفاف، تحت کنترل شما.
        </h2>
        <p className="landing-support">
          اطلاعات مالی شما برای خودتان است؛ وِزان کمک می‌کند وضعیت مالی‌تان را روشن‌تر ببینید و بهتر
          مدیریت کنید.
        </p>
        <p className="landing-support landing-trust-links">
          <Link href="/privacy" className="font-medium" style={{ color: "var(--brand)" }}>
            حریم خصوصی
          </Link>
          <span className="muted" aria-hidden="true">
            ·
          </span>
          <Link href="/about" className="font-medium" style={{ color: "var(--brand)" }}>
            درباره وِزان
          </Link>
        </p>
      </section>

      <section className="landing-wrap landing-section" aria-labelledby="final-cta-title">
        <div className="landing-cta-final">
          <h2 id="final-cta-title" className="landing-h2">
            تصویر مالی‌تان را یکجا ببینید.
          </h2>
          <p className="landing-support mx-auto">
            ارزش خالص، دارایی‌ها، بدهی‌ها و نقدینگی خود را در یک نمای روشن مدیریت کنید.
          </p>
          <CtaCluster align="center" />
        </div>
      </section>

      <LandingFooter />
    </div>
  );
}
