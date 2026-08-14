import Link from "next/link";
import AnimatedNumber from "@/components/landing/AnimatedNumber";
import Reveal from "@/components/landing/Reveal";
import Icon, { type IconName } from "@/components/ui/Icon";

/* ────────────────────────────────────────────────────────────────
   HeroDashboard — a truthful, premium preview of the real product.
   All figures are realistic MOCK data (never a real user's numbers).
   Mirrors the product's actual OverviewDashboard patterns:
   net worth hero number + delta, metrics, cash-flow strip,
   budget meter and structured recent transactions.
   ──────────────────────────────────────────────────────────────── */

const fmt = (n: number) => n.toLocaleString("en-US");

const NW_SERIES = [142, 147, 151, 157, 160, 165, 170, 174, 178, 181, 183, 184.25];

function sparkPaths(pts: number[], w = 320, h = 84, pad = 8) {
  const min = Math.min(...pts);
  const max = Math.max(...pts);
  const x = (i: number) => pad + (i * (w - pad * 2)) / (pts.length - 1);
  const y = (v: number) => h - pad - ((v - min) / (max - min)) * (h - pad * 2);
  const line = pts
    .map((v, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(v).toFixed(1)}`)
    .join(" ");
  const area = `${line} L${x(pts.length - 1).toFixed(1)},${h - pad} L${x(0).toFixed(1)},${h - pad} Z`;
  const last = { cx: x(pts.length - 1).toFixed(1), cy: y(pts[pts.length - 1]).toFixed(1) };
  return { line, area, last };
}

const TX = [
  {
    icon: "arrow-up" as IconName,
    name: "حقوق ماهانه",
    cat: "درآمد · شغل اصلی",
    amt: "+$4,800",
    tone: "pos-t",
  },
  {
    icon: "arrow-down" as IconName,
    name: "خرید مواد غذایی",
    cat: "هزینه · خوراک",
    amt: "−$320",
    tone: "neg-t",
  },
  {
    icon: "coins" as IconName,
    name: "خرید طلا",
    cat: "سرمایه‌گذاری",
    amt: "−$2,500",
    tone: "neu-t",
  },
  {
    icon: "installments" as IconName,
    name: "قسط خودرو",
    cat: "بدهی · قسط ۶ از ۲۴",
    amt: "−$890",
    tone: "neu-t",
  },
];

function HeroDashboard() {
  const s = sparkPaths(NW_SERIES);
  return (
    <div
      className="dash"
      role="img"
      aria-label="پیش‌نمایش داشبورد تراز: ارزش خالص ۱۸۴٬۲۵۰ دلار با رشد ۸.۴٪، دارایی‌ها ۲۳۱٬۵۰۰ دلار، بدهی‌ها ۴۷٬۲۵۰ دلار، درآمد ۱۲٬۴۰۰ دلار، هزینه ۵٬۲۸۰ دلار، سرمایه‌گذاری ۲٬۵۰۰ دلار و جریان نقدی ۷٬۱۲۰ دلار — همراه بودجه ماهانه و تراکنش‌های نمونه"
    >
      <div className="dash-chrome" aria-hidden="true">
        <i />
        <i />
        <i />
        <span className="dash-title">تراز · نمای کلی</span>
        <span className="dash-month">مرداد ۱۴۰۵</span>
      </div>

      <div className="dash-body">
        {/* Net worth — the hero number */}
        <p className="dash-label">ارزش خالص</p>
        <div className="dash-nw">
          <p className="dash-nw-num" dir="ltr">
            $<AnimatedNumber value={184250} />
          </p>
          <span className="dash-delta">
            <Icon name="trend-up" size={13} strokeWidth={2.2} />
            8.4%
          </span>
        </div>
        <p className="dash-nw-sub">تغییر نسبت به ماه گذشته</p>

        <div className="dash-chart" aria-hidden="true">
          <svg viewBox={`0 0 320 84`} preserveAspectRatio="none">
            <path d={s.area} fill="var(--brand)" opacity="0.08" />
            <path
              d={s.line}
              className="spark-line"
              fill="none"
              stroke="var(--brand)"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              pathLength={1}
            />
            <circle cx={s.last.cx} cy={s.last.cy} r="3.6" fill="var(--brand)" stroke="var(--surface)" strokeWidth="2" />
          </svg>
        </div>

        {/* Wealth structure */}
        <div className="dash-metrics">
          <div className="dash-metric">
            <p className="m-label">دارایی‌ها</p>
            <p className="m-val" dir="ltr">
              ${fmt(231500)}
            </p>
          </div>
          <div className="dash-metric">
            <p className="m-label">بدهی‌ها</p>
            <p className="m-val" dir="ltr">
              ${fmt(47250)}
            </p>
          </div>
          <div className="dash-metric">
            <p className="m-label">نقدشونده</p>
            <p className="m-val" dir="ltr">
              ${fmt(61400)}
            </p>
          </div>
        </div>

        {/* Monthly cash flow */}
        <div className="dash-strip">
          <div className="dash-cell">
            <p className="c-label">درآمد</p>
            <p className="c-val pos-t" dir="ltr">
              +${fmt(12400)}
            </p>
          </div>
          <div className="dash-cell">
            <p className="c-label">هزینه</p>
            <p className="c-val neg-t" dir="ltr">
              −${fmt(5280)}
            </p>
          </div>
          <div className="dash-cell">
            <p className="c-label">سرمایه‌گذاری</p>
            <p className="c-val neu-t" dir="ltr">
              −${fmt(2500)}
            </p>
          </div>
          <div className="dash-cell">
            <p className="c-label">جریان نقدی</p>
            <p className="c-val pos-t" dir="ltr">
              +${fmt(7120)}
            </p>
          </div>
        </div>

        {/* Budget status */}
        <div className="dash-budget">
          <div className="dash-budget-head">
            <b>بودجه ماهانه</b>
            <span>۶۸٪ مصرف‌شده</span>
          </div>
          <div className="dash-meter" aria-hidden="true">
            <i style={{ width: "68%" }} />
          </div>
          <p className="dash-budget-sub">بودجه خوراک · $850 از $1,250</p>
        </div>

        {/* Recent transactions */}
        <ul className="dash-tx">
          {TX.map((t) => (
            <li key={t.name}>
              <span className="tx-ico" aria-hidden="true">
                <Icon name={t.icon} size={17} />
              </span>
              <span className="min-w-0">
                <span className="tx-name block truncate">{t.name}</span>
                <span className="tx-cat block">{t.cat}</span>
              </span>
              <span className={`tx-amt ${t.tone}`} dir="ltr">
                {t.amt}
              </span>
            </li>
          ))}
        </ul>

        <p className="dash-note">پیش‌نمایش نمونه — داده آزمایشی، نه داده واقعی کاربر</p>
      </div>
    </div>
  );
}

export default function LandingHero() {
  return (
    <section className="landing-wrap landing-hero" aria-labelledby="hero-title">
      <div>
        <Reveal>
          <p className="ld-eyebrow">مدیریت مالی شخصی، فراتر از ثبت هزینه‌ها</p>
        </Reveal>
        <Reveal delay={60}>
          <h1 id="hero-title" className="ld-h1">
            تمام ثروت، درآمد و هزینه‌هایتان را در یک نگاه مدیریت کنید.
          </h1>
        </Reveal>
        <Reveal delay={120}>
          <p className="ld-lead">
            درآمدها، هزینه‌ها، دارایی‌ها، بدهی‌ها، سرمایه‌گذاری‌ها و جریان نقدی خود را در یک سیستم منسجم ثبت،
            دسته‌بندی و تحلیل کنید؛ بدون فایل‌های پراکنده و بدون حدس‌زدن درباره وضعیت مالی‌تان.
          </p>
        </Reveal>
        <Reveal delay={180}>
          <div className="ld-hero-ctas">
            <Link href="/register" className="btn btn-primary">
              شروع مدیریت مالی
            </Link>
            <Link href="#how" className="btn btn-ghost">
              مشاهده نحوه کار
            </Link>
          </div>
        </Reveal>
        <Reveal delay={240}>
          <p className="ld-hero-note">
            <span>
              <b>یک سیستم</b> برای پول، دارایی و ثروت
            </span>
            <span>·</span>
            <span>
              <b>داده‌ها</b> متعلق به خود شماست
            </span>
            <span>·</span>
            <span>قابل استفاده روی <b dir="ltr" className="ltr-isolate">iPhone</b>، <b dir="ltr" className="ltr-isolate">Android</b> و وب</span>
          </p>
        </Reveal>
      </div>

      <Reveal delay={140} className="min-w-0">
        <HeroDashboard />
      </Reveal>
    </section>
  );
}
