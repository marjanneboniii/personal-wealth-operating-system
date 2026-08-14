import Link from "next/link";
import Reveal from "@/components/landing/Reveal";
import SectionHead from "@/components/landing/SectionHead";
import Icon, { type IconName } from "@/components/ui/Icon";

/* ════════════════════════════════════════════════════════════════
   Trust — honest, claim-free. Every line maps to something that is
   actually implemented in the product (no invented security claims).
   ════════════════════════════════════════════════════════════════ */

const TRUST = [
  {
    icon: "lock" as IconName,
    title: "کنترل داده‌ها",
    body: "داده‌های مالی شما متعلق به خود شماست.",
    sub: "سوابق به حساب شما وابسته‌اند؛ پشتیبان‌گیری و بازیابی برای نقش‌های مجاز در تنظیمات در دسترس است.",
  },
  {
    icon: "info" as IconName,
    title: "شفافیت",
    body: "هیچ تصمیم مالی بدون تأیید شما اجرا نمی‌شود.",
    sub: "برنامه‌ها و پیش‌بینی‌ها تا لحظه اجرای صریح، هیچ اثری روی دفترکل ندارند.",
  },
  {
    icon: "audit" as IconName,
    title: "قابل پیگیری",
    body: "اطلاعات و تغییرات مالی ساختاریافته و قابل بررسی هستند.",
    sub: "هر سند تا دفترکل، گزارش‌ها و آزمون‌های یکپارچگی قابل ردیابی است.",
  },
  {
    icon: "layers" as IconName,
    title: "حریم خصوصی",
    body: "اطلاعات مالی شما با رویکرد Privacy-first مدیریت می‌شود.",
    sub: "قابل اجرا روی زیرساخت خودتان؛ بدون درخواست خارجی اجباری و بدون تله‌متری.",
  },
];

function TrustSection() {
  return (
    <section className="landing-section ld-rule" id="trust" aria-labelledby="trust-title">
      <div className="landing-wrap">
        <Reveal>
          <SectionHead
            kicker="اعتماد"
            title="حریم خصوصی، مالکیت و کنترل"
            lead="چیزهایی که می‌گوییم، چیزهایی است که در محصول پیاده شده است."
          />
        </Reveal>

        <div className="ld-trust">
          {TRUST.map((t, i) => (
            <Reveal key={t.title} delay={i * 60}>
              <div className="ld-trust-item">
                <h3>
                  <Icon name={t.icon} size={18} />
                  {t.title}
                </h3>
                <p>{t.body}</p>
                <p className="t-sub">{t.sub}</p>
              </div>
            </Reveal>
          ))}
        </div>

        <Reveal delay={120}>
          <p className="ld-trust-note">
            ما ادعای امنیتی‌ای را مطرح نمی‌کنیم که در محصول پیاده نشده باشد؛ اگر قابلیتی در آینده اضافه شود، همین‌جا،
            شفاف معرفی می‌شود.
          </p>
        </Reveal>
      </div>
    </section>
  );
}

/* ════════════════════════════════════════════════════════════════
   Why Taraz — the product story (short, honest)
   ════════════════════════════════════════════════════════════════ */

function WhySection() {
  return (
    <section className="landing-section ld-rule" id="about" aria-labelledby="about-title">
      <div className="landing-wrap">
        <Reveal>
          <div className="ld-why">
            <SectionHead kicker="درباره تراز" title="چرا تراز ساخته شد؟" />
            <p className="ld-why-text">
              پول شما فقط چند عدد در چند حساب مختلف نیست. تراز برای این ساخته شده است که درآمد، هزینه، دارایی،
              بدهی، جریان نقدی و ارزش خالص شما را در یک سیستم منسجم کنار هم قرار دهد؛ تا به‌جای حدس‌زدن درباره
              وضعیت مالی، آن را ببینید و درک کنید.
            </p>
            <Link href="/about" className="ld-why-link">
              ادامه درباره تراز
              <Icon name="arrow-start" size={15} />
            </Link>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

/* ════════════════════════════════════════════════════════════════
   Final CTA — the conversion moment
   ════════════════════════════════════════════════════════════════ */

function FinalCtaSection() {
  return (
    <section className="landing-section" aria-labelledby="cta-title">
      <div className="landing-wrap">
        <Reveal>
          <div className="ld-cta">
            <h2 id="cta-title">تصویر واقعی ثروت‌تان را ببینید.</h2>
            <p>
              مدیریت مالی از جایی شروع می‌شود که بدانید پول‌تان کجاست و چه اتفاقی برای آن می‌افتد.
            </p>
            <div className="ld-hero-ctas">
              <Link href="/register" className="btn btn-primary">
                شروع مدیریت مالی
              </Link>
              <Link href="/login" className="btn btn-ghost">
                ورود به حساب
              </Link>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

export { TrustSection, WhySection, FinalCtaSection };
