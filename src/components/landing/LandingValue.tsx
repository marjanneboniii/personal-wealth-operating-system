import type { ReactNode } from "react";
import Reveal from "@/components/landing/Reveal";
import SectionHead from "@/components/landing/SectionHead";
import Icon, { type IconName } from "@/components/ui/Icon";

/* ════════════════════════════════════════════════════════════════
   Features — outcome-first (feature + user outcome + inline proof).
   Only capabilities that actually exist in the product are shown.
   ════════════════════════════════════════════════════════════════ */

const FEATURES: {
  icon: IconName;
  title: string;
  body: string;
  proof: ReactNode;
}[] = [
  {
    icon: "networth",
    title: "بفهمید واقعاً چقدر ثروت دارید",
    body: "ارزش دارایی‌ها و بدهی‌های خود را در یک تصویر واحد ببینید و تغییرات ثروت‌تان را در طول زمان دنبال کنید.",
    proof: (
      <span dir="ltr">
        $184,250 <span className="pos-t">↑ 8.4%</span>
      </span>
    ),
  },
  {
    icon: "cashflow",
    title: "ببینید پول‌تان از کجا می‌آید و کجا می‌رود",
    body: "تمام ورودی‌ها، خروجی‌ها و انتقالات را در یک نمای قابل‌فهم دنبال کنید — بدون اینکه انتقال بین حساب‌ها جریان واقعی را مخدوش کند.",
    proof: (
      <span className="inline-flex items-center gap-2">
        <span className="neu-t">این ماه</span>
        <span dir="ltr">
          <span className="pos-t">+$12,400</span> <span className="neg-t">−$5,280</span>
        </span>
      </span>
    ),
  },
  {
    icon: "budgets",
    title: "قبل از خرج کردن تصمیم بگیرید",
    body: "برای هزینه‌های خود بودجه تعیین کنید و ببینید چقدر از آن مصرف شده است — در لحظه، نه آخر ماه.",
    proof: (
      <span className="inline-flex items-center gap-2">
        <span className="dash-meter !h-1.5 !w-24" aria-hidden="true">
          <i style={{ width: "68%", background: "var(--brand)" }} />
        </span>
        <span>۶۸٪ مصرف‌شده</span>
      </span>
    ),
  },
  {
    icon: "transactions",
    title: "هر جریان مالی را ساختاریافته ثبت کنید",
    body: "درآمد، هزینه، انتقال، خرید، فروش، بدهی و پرداخت‌ها را با ساختار مشخص ثبت و پیگیری کنید.",
    proof: (
      <span className="flex flex-wrap gap-1.5">
        <span className="pf-chip">
          <Icon name="arrow-up" size={12} />
          حقوق <span className="pos-t">+$4,800</span>
        </span>
        <span className="pf-chip">
          <Icon name="arrow-down" size={12} />
          خوراک <span className="neg-t">−$320</span>
        </span>
        <span className="pf-chip">
          <Icon name="coins" size={12} />
          طلا <span className="neu-t">−$2,500</span>
        </span>
      </span>
    ),
  },
  {
    icon: "ledger",
    title: "به هر عددی که می‌بینید اعتماد کنید",
    body: "هسته حسابداری دوطرفه با دفترکل و سوابق قابل بررسی — هر رقم، تا سند اصلی قابل پیگیری است.",
    proof: (
      <span className="inline-flex items-center gap-1.5">
        <Icon name="check-circle" size={16} style={{ color: "var(--positive)" }} />
        بررسی زنده یکپارچگی سوابق
      </span>
    ),
  },
  {
    icon: "portfolio",
    title: "سبد دارایی‌هایتان را یکجا ببینید",
    body: "ملک، خودرو، رمزارز، طلا و سایر دارایی‌ها با ارزش‌گذاری و تاریخچه — نه فقط پول نقد.",
    proof: (
      <span className="flex flex-wrap gap-1.5">
        <span className="pf-chip">ملک</span>
        <span className="pf-chip">خودرو</span>
        <span className="pf-chip">رمزارز</span>
        <span className="pf-chip">طلا و کالا</span>
      </span>
    ),
  },
];

function FeaturesSection() {
  return (
    <section className="landing-section ld-rule" id="features" aria-labelledby="features-title">
      <div className="landing-wrap">
        <Reveal>
          <SectionHead
            kicker="امکانات"
            title="هر قابلیت، یک پرسش مالی را پاسخ می‌دهد"
            lead="تراز فقط ثبت نمی‌کند؛ می‌فهماند. هر بخش از محصول، یک سؤال مشخص درباره پول شما را جواب می‌دهد."
          />
        </Reveal>

        <div className="ld-features">
          {FEATURES.map((f, i) => (
            <Reveal key={f.title} delay={i * 40}>
              <article className="ld-feature">
                <span className="ld-feature-ico" aria-hidden="true">
                  <Icon name={f.icon} size={21} />
                </span>
                <h3>{f.title}</h3>
                <p>{f.body}</p>
                <div className="f-proof">{f.proof}</div>
              </article>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ════════════════════════════════════════════════════════════════
   Data → Understanding — the month, turned into meaning
   ════════════════════════════════════════════════════════════════ */

const MONTH_ROWS = [
  { name: "درآمد", icon: "arrow-up" as IconName, val: "+12,400", pct: 100, tone: "pos-t", bar: "var(--positive)" },
  { name: "هزینه", icon: "arrow-down" as IconName, val: "−5,280", pct: 43, tone: "neg-t", bar: "var(--negative)" },
  { name: "سرمایه‌گذاری", icon: "coins" as IconName, val: "−2,500", pct: 20, tone: "neu-t", bar: "var(--brand)" },
  { name: "پس‌انداز", icon: "wallet" as IconName, val: "+4,620", pct: 37, tone: "pos-t", bar: "var(--positive)" },
];

function UnderstandingSection() {
  return (
    <section className="landing-section ld-rule" id="understand" aria-labelledby="understand-title">
      <div className="landing-wrap ld-understand">
        <div>
          <Reveal>
            <SectionHead
              kicker="از داده تا فهم"
              title="از تراکنش‌های پراکنده تا یک تصویر مالی واضح"
            />
          </Reveal>
          <Reveal delay={80}>
            <p className="sec-lead">
              تراز فقط داده ذخیره نمی‌کند؛ داده را به فهم مالی تبدیل می‌کند. هر تراکنش، جای خودش را در تصویر بزرگ‌تر
              پیدا می‌کند — درآمد چقدر بود، کجا خرج شد، چقدر سرمایه‌گذاری شد و در نهایت چقدر ماند.
            </p>
          </Reveal>
        </div>

        <Reveal delay={140}>
          <div
            className="ld-month"
            role="img"
            aria-label="پیش‌نمایش خلاصه ماه جاری در تراز: درآمد ۱۲٬۴۰۰، هزینه ۵٬۲۸۰، سرمایه‌گذاری ۲٬۵۰۰، پس‌انداز ۴٬۶۲۰ و رشد ارزش خالص ۳.۸٪"
          >
            <div className="ld-month-head">
              <b>ماه جاری</b>
              <span>مرداد ۱۴۰۵</span>
            </div>
            {MONTH_ROWS.map((r) => (
              <div key={r.name} className="ld-month-row">
                <span className="m-name">
                  <Icon name={r.icon} size={15} />
                  {r.name}
                </span>
                <span className={`m-val ${r.tone}`} dir="ltr">
                  {r.val}
                </span>
                <span className="m-bar" aria-hidden="true">
                  <i style={{ width: `${r.pct}%`, background: r.bar }} />
                </span>
              </div>
            ))}
            <div className="ld-month-foot">
              <b>
                <Icon name="trend-up" size={15} strokeWidth={2.2} />
                ارزش خالص
              </b>
              <span dir="ltr">↑ 3.8%</span>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

/* ════════════════════════════════════════════════════════════════
   Personas
   ════════════════════════════════════════════════════════════════ */

const PERSONAS = [
  {
    icon: "ledger" as IconName,
    title: "افراد دقیق",
    body: "برای کسانی که می‌خواهند دقیقاً بدانند پول‌شان کجا می‌رود و هر ماه کجا بوده است.",
  },
  {
    icon: "home" as IconName,
    title: "خانواده‌ها",
    body: "برای کسانی که می‌خواهند درآمد، هزینه، بدهی و بودجه خانوار را در یک جا مدیریت کنند.",
  },
  {
    icon: "portfolio" as IconName,
    title: "سرمایه‌گذاران",
    body: "برای کسانی که چند نوع دارایی و سرمایه‌گذاری دارند و می‌خواهند تصویر واقعی ثروت‌شان را ببینند.",
  },
];

function PersonasSection() {
  return (
    <section className="landing-section ld-rule" id="personas" aria-labelledby="personas-title">
      <div className="landing-wrap">
        <Reveal>
          <SectionHead
            kicker="برای چه کسی؟"
            title="تراز برای چه کسانی ساخته شده است؟"
            lead="یک سیستم مالی شخصی، برای هر سبک مدیریت مالی — با همان دقت و شفافیت."
          />
        </Reveal>

        <div className="ld-personas">
          {PERSONAS.map((p, i) => (
            <Reveal key={p.title} delay={i * 70}>
              <div className="ld-persona">
                <span className="p-ico" aria-hidden="true">
                  <Icon name={p.icon} size={20} />
                </span>
                <h3>{p.title}</h3>
                <p>{p.body}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ════════════════════════════════════════════════════════════════
   How it works — ثبت → دسته‌بندی → تحلیل → تصمیم
   ════════════════════════════════════════════════════════════════ */

const STEPS = [
  { num: "۰۱", title: "ثبت", body: "درآمد، هزینه، انتقال و خرید را همان لحظه ثبت کنید.", chain: "ثبت اطلاعات" },
  { num: "۰۲", title: "دسته‌بندی", body: "هر جریان پول، جای روشنی در ساختار دارد.", chain: "ساختاردهی" },
  { num: "۰۳", title: "تحلیل", body: "گزارش‌ها، روندها و ارزش خالص از دادهٔ شما ساخته می‌شوند.", chain: "محاسبه · گزارش" },
  { num: "۰۴", title: "تصمیم", body: "تصویر روشن، تصمیم بهتر — بدون حدس و گمان.", chain: "تصمیم بهتر" },
];

function HowItWorksSection() {
  return (
    <section className="landing-section ld-rule" id="how" aria-labelledby="how-title">
      <div className="landing-wrap">
        <Reveal>
          <SectionHead
            kicker="نحوه کار"
            title="از یک ثبت ساده تا تصمیم بهتر"
            lead="چهار قدم کوتاه؛ بقیه مسیر را سیستم طی می‌کند."
            center
          />
        </Reveal>

        <div className="ld-steps">
          {STEPS.map((s, i) => (
            <Reveal key={s.num} delay={i * 70}>
              <div className="ld-step">
                <span className="ld-step-num">{s.num}</span>
                <h3>{s.title}</h3>
                <p>{s.body}</p>
                <span className="s-chain">{s.chain}</span>
              </div>
            </Reveal>
          ))}
        </div>

        <Reveal delay={120}>
          <p className="ld-chain-strip" aria-hidden="true">
            <b>ثبت اطلاعات</b>
            <Icon name="arrow-start" size={14} />
            <span>ساختاردهی</span>
            <Icon name="arrow-start" size={14} />
            <span>محاسبه</span>
            <Icon name="arrow-start" size={14} />
            <span>گزارش</span>
            <Icon name="arrow-start" size={14} />
            <b>تصمیم بهتر</b>
          </p>
        </Reveal>
      </div>
    </section>
  );
}

export { FeaturesSection, UnderstandingSection, PersonasSection, HowItWorksSection };
