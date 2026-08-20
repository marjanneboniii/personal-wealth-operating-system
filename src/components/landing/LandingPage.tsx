import Link from "next/link";
import { LandingFooter, LandingHeader } from "@/components/landing/LandingChrome";
import { DownloadIosButton } from "@/components/pwa/IosInstallGuide";
import Icon, { type IconName } from "@/components/ui/Icon";

const BENEFITS: { icon: IconName; title: string; body: string }[] = [
  { icon: "networth", title: "ارزش خالص", body: "دارایی‌ها منهای بدهی‌ها، در یک عدد روشن." },
  { icon: "portfolio", title: "دارایی‌ها", body: "ترکیب سبد را یکجا ببینید." },
  { icon: "wallet", title: "نقدینگی", body: "آنچه نقدشونده است، جدا از کل ثروت." },
  { icon: "transactions", title: "تراکنش‌ها", body: "درآمد، هزینه، انتقال و معاملات." },
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
        <p className="muted text-[11px] font-medium">ارزش خالص</p>
        <p className="display-num mt-1 text-[28px] font-bold tracking-tight sm:text-[32px]" dir="ltr">
          —
        </p>
        <div className="mt-4 grid grid-cols-3 gap-3 border-t pt-3.5" style={{ borderColor: "var(--border)" }}>
          {[
            { label: "دارایی‌ها" },
            { label: "بدهی‌ها" },
            { label: "نقد" },
          ].map((m) => (
            <div key={m.label}>
              <p className="muted text-[10.5px]">{m.label}</p>
              <p className="display-num mt-1 text-[15px] font-semibold" dir="ltr">
                —
              </p>
            </div>
          ))}
        </div>
        <div className="comp-bar mt-4">
          <span style={{ width: "42%", background: "var(--asset-cash)" }} />
          <span style={{ width: "28%", background: "var(--asset-investment)" }} />
          <span style={{ width: "18%", background: "var(--asset-crypto)" }} />
          <span style={{ width: "12%", background: "var(--asset-other)" }} />
        </div>
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
          <p className="landing-lede">دارایی‌ها، بدهی‌ها، نقدینگی و ارزش خالص شما در یک تصویر آرام و روشن.</p>
          <div className="mt-6 flex flex-col gap-2.5 sm:flex-row sm:items-center">
            <Link href="/login" className="btn btn-primary !min-h-12 w-full sm:w-auto sm:px-6">
              ورود به سیستم
            </Link>
            <Link href="/register" className="btn !min-h-12 w-full sm:w-auto sm:px-6">
              ایجاد حساب
            </Link>
            <DownloadIosButton className="!min-h-12 w-full sm:w-auto sm:px-5" variant="ghost" />
          </div>
        </div>
        <ProductPreview />
      </section>

      <section className="landing-wrap landing-section" aria-labelledby="benefits-title">
        <h2 id="benefits-title" className="landing-h2">
          آنچه در یک نگاه می‌بینید
        </h2>
        <div className="mt-2">
          {BENEFITS.map((item) => (
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
        <h2 id="trust-title" className="sr-only">
          اعتماد
        </h2>
        <div className="landing-trust">
          <span>خصوصی</span>
          <span>قابل کنترل</span>
          <span>قابل بازبینی</span>
          <span>بدون ادعاهای امنیتی اثبات‌نشده</span>
        </div>
        <p className="landing-support">
          جزئیات در{" "}
          <Link href="/privacy" className="font-medium" style={{ color: "var(--brand)" }}>
            حریم خصوصی
          </Link>{" "}
          و{" "}
          <Link href="/about" className="font-medium" style={{ color: "var(--brand)" }}>
            درباره وِزان
          </Link>
          .
        </p>
      </section>

      <section className="landing-wrap landing-section" aria-labelledby="final-cta-title">
        <div className="landing-cta-final">
          <h2 id="final-cta-title" className="landing-h2">
            تصویر مالی‌تان را یکجا ببینید.
          </h2>
          <p className="landing-support mx-auto">ورود کنید یا حساب بسازید. روی آیفون می‌توانید وزان را به صفحه اصلی اضافه کنید.</p>
          <div className="mt-5 flex flex-col gap-2.5 sm:flex-row sm:justify-center">
            <Link href="/login" className="btn btn-primary !min-h-12 sm:px-6">
              ورود به سیستم
            </Link>
            <Link href="/register" className="btn !min-h-12 sm:px-6">
              ایجاد حساب
            </Link>
            <DownloadIosButton className="!min-h-12 sm:px-5" variant="default">
              Download iOS
            </DownloadIosButton>
          </div>
        </div>
      </section>

      <LandingFooter />
    </div>
  );
}
