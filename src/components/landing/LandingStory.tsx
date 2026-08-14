import Reveal from "@/components/landing/Reveal";
import SectionHead from "@/components/landing/SectionHead";
import Icon, { type IconName } from "@/components/ui/Icon";

/* ════════════════════════════════════════════════════════════════
   Problem — scattered financial reality
   ════════════════════════════════════════════════════════════════ */

const SCATTER: { label: string; icon: IconName }[] = [
  { label: "بانک", icon: "accounts" },
  { label: "کارت", icon: "card" },
  { label: "کیف پول", icon: "wallet" },
  { label: "سرمایه‌گذاری", icon: "portfolio" },
  { label: "ارز", icon: "coins" },
  { label: "بدهی", icon: "debts" },
  { label: "قسط", icon: "installments" },
  { label: "هزینه", icon: "arrow-down" },
  { label: "درآمد", icon: "arrow-up" },
];

function ProblemSection() {
  return (
    <section className="landing-section ld-rule" id="problem" aria-labelledby="problem-title">
      <div className="landing-wrap ld-problem">
        <div>
          <Reveal>
            <SectionHead
              kicker="مسئله"
              title="مشکل فقط خرج کردن نیست؛ ندیدن تصویر کامل است."
            />
          </Reveal>
          <Reveal delay={80}>
            <p className="sec-lead">
              حساب بانکی، کارت، کیف پول، سرمایه‌گذاری، بدهی، اقساط و هزینه‌های روزمره هرکدام بخشی از وضعیت مالی شما
              هستند. وقتی این اطلاعات پراکنده باشند، درک ارزش واقعی ثروت و جریان پول دشوار می‌شود.
            </p>
          </Reveal>
        </div>

        <Reveal delay={120}>
          <div className="ld-scatter" aria-hidden="true">
            {SCATTER.map((c) => (
              <span key={c.label} className="ld-chip">
                <Icon name={c.icon} size={15} />
                {c.label}
              </span>
            ))}
          </div>
          <div className="ld-converge" aria-hidden="true">
            <span className="ld-converge-line" />
            <span className="ld-core">
              <Icon name="scale" size={20} />
              تراز
            </span>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

/* ════════════════════════════════════════════════════════════════
   Solution — every money flow becomes one picture
   ════════════════════════════════════════════════════════════════ */

const FLOW: {
  icon: IconName;
  title: string;
  sub: string;
  final?: boolean;
}[] = [
  { icon: "arrow-up", title: "درآمد", sub: "هر ورودی پول: حقوق، کسب‌وکار، بازده" },
  { icon: "transactions", title: "تراکنش", sub: "ثبت ساختاریافته در دفتر" },
  { icon: "coins", title: "هزینه / سرمایه‌گذاری", sub: "خروج یا تخصیص پول، با دسته‌بندی روشن" },
  { icon: "portfolio", title: "دارایی‌ها", sub: "آنچه دارید: نقد و غیرنقد" },
  { icon: "debts", title: "بدهی‌ها", sub: "تعهدات و اقساط، شفاف و قابل پیگیری" },
  { icon: "cashflow", title: "جریان نقدی", sub: "ورود و خروج واقعی پول" },
  { icon: "networth", title: "ارزش خالص", sub: "دارایی منهای بدهی، در یک عدد" },
  {
    icon: "check-circle",
    title: "تحلیل و تصمیم‌گیری",
    sub: "تصویر روشن، برای انتخاب بهتر",
    final: true,
  },
];

function SolutionSection() {
  const left = FLOW.slice(0, 4);
  const right = FLOW.slice(4);
  return (
    <section className="landing-section" id="solution" aria-labelledby="solution-title">
      <div className="landing-wrap">
        <Reveal>
          <SectionHead
            kicker="راه‌حل"
            title="تراز همه جریان‌های مالی شما را به یک تصویر واحد تبدیل می‌کند."
            lead="هر پولی که وارد می‌شود، جابه‌جا می‌شود یا خارج می‌شود، یک مسیر روشن دارد — از لحظه ثبت تا تصویر نهایی ثروت."
          />
        </Reveal>

        <div className="ld-flow">
          {[left, right].map((col, ci) => (
            <div key={ci} className="ld-flow-col">
              {col.map((n) => (
                <Reveal key={n.title} delay={40}>
                  <div className={`ld-flow-node ${n.final ? "final" : ""}`}>
                    <span className="ld-node-ico" aria-hidden="true">
                      <Icon name={n.icon} size={19} />
                    </span>
                    <div className="ld-node-body">
                      <h3>{n.title}</h3>
                      <p>{n.sub}</p>
                    </div>
                  </div>
                </Reveal>
              ))}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ════════════════════════════════════════════════════════════════
   Connected — one system, not separate modules
   ════════════════════════════════════════════════════════════════ */

const MESH: { icon: IconName; name: string; desc: string }[] = [
  { icon: "arrow-up", name: "درآمد", desc: "تمام ورودی‌های پول" },
  { icon: "arrow-down", name: "هزینه", desc: "تمام خروجی‌های واقعی" },
  { icon: "swap", name: "انتقال", desc: "جابه‌جایی بین حساب‌ها بدون تحریف جریان" },
  { icon: "portfolio", name: "دارایی", desc: "دارایی‌های نقدی و غیرنقدی" },
  { icon: "debts", name: "بدهی", desc: "تعهدات و بدهی‌ها" },
  { icon: "coins", name: "سرمایه‌گذاری", desc: "خرید، فروش و عملکرد دارایی‌ها" },
  { icon: "budgets", name: "بودجه", desc: "برنامه‌ریزی و کنترل هزینه‌ها" },
  { icon: "cashflow", name: "جریان نقدی", desc: "درک ورود و خروج واقعی پول" },
];

function MeshWeb() {
  const lines = [
    "16.6,16.6",
    "50,16.6",
    "83.3,16.6",
    "16.6,50",
    "83.3,50",
    "16.6,83.3",
    "50,83.3",
    "83.3,83.3",
  ];
  return (
    <svg className="web" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
      {lines.map((p) => (
        <line
          key={p}
          x1="50"
          y1="50"
          x2={p.split(",")[0]}
          y2={p.split(",")[1]}
          stroke="var(--border-strong)"
          strokeWidth="0.4"
        />
      ))}
    </svg>
  );
}

function ConnectedSection() {
  return (
    <section className="landing-section ld-rule" id="product" aria-labelledby="product-title">
      <div className="landing-wrap">
        <Reveal>
          <SectionHead
            kicker="معماری محصول"
            title="همه چیز به هم متصل است"
            lead="درآمد، هزینه، دارایی، بدهی و سرمایه‌گذاری ماژول‌های جدا نیستند؛ اجزای یک سیستم‌اند که در نهایت به یک تصویر واحد می‌رسند."
            center
          />
        </Reveal>

        <Reveal delay={100}>
          <div className="ld-mesh-wrap">
            <div className="ld-mesh">
              <MeshWeb />
              {MESH.slice(0, 4).map((m) => (
                <div key={m.name} className="ld-cell">
                  <span className="c-ico">
                    <Icon name={m.icon} size={19} />
                  </span>
                  <h3>{m.name}</h3>
                  <p>{m.desc}</p>
                </div>
              ))}
              <div className="ld-cell core">
                <span className="c-ico">
                  <Icon name="scale" size={21} />
                </span>
                <h3>تراز</h3>
                <p>یک سیستم منسجم</p>
              </div>
              {MESH.slice(4).map((m) => (
                <div key={m.name} className="ld-cell">
                  <span className="c-ico">
                    <Icon name={m.icon} size={19} />
                  </span>
                  <h3>{m.name}</h3>
                  <p>{m.desc}</p>
                </div>
              ))}
            </div>
            <div aria-hidden="true">
              <div className="ld-mesh-arrow" />
            </div>
            <div className="ld-mesh-out">
              <span className="ld-core">
                <Icon name="networth" size={20} />
                ارزش خالص — تصویر نهایی وضعیت مالی
              </span>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

export { ProblemSection, SolutionSection, ConnectedSection };
