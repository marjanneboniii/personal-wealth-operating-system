import type { ReactNode } from "react";
import BrandMark from "../../src/components/layout/BrandMark";
import Icon from "../../src/components/ui/Icon";
import { PRODUCT_FILM_CHAPTERS, PRODUCT_PREVIEW_CHAPTERS, type ProductFilmKind, type ProductFilmScene } from "../../src/lib/productFilms";

function Field({ label, value, type = false }: { label: string; value: string; type?: boolean }) {
  return <div className="film-field" data-reveal><span data-critical>{label}</span><b data-critical {...(type ? { "data-type": value } : {})}>{value}</b></div>;
}
function Button({ children }: { children: ReactNode }) {
  return <div className="film-action" data-reveal data-target><span data-critical>{children}</span><Icon name="arrow-start" size={42} /></div>;
}
function Total({ label, value }: { label: string; value: string }) {
  return <div className="film-total" data-reveal><span data-critical>{label} · تومان</span><strong data-critical>{value}</strong></div>;
}
function MoneyRow({ label, value, changed }: { label: string; value: string; changed?: string }) {
  return <div className="film-money-row" data-reveal><span data-critical>{label}</span><b data-critical {...(changed ? { "data-from": changed, "data-to": value } : {})}>{value}</b></div>;
}
function Content({ scene }: { scene: ProductFilmScene }) {
  switch (scene) {
    case "start": return <><div className="film-welcome" data-reveal><BrandMark size={72} /><h2 data-critical>به توازن خوش آمدید.</h2></div><Field label="نام شما" value="سارا" type /><Field label="نرخ مرجع تتر · نمونه" value="۸۶٬۰۰۰ تومان" /><Button>شروع راه‌اندازی</Button></>;
    case "accounts": return <><Field label="حساب روزمره" value="بانک ملت" /><Field label="موجودی اولیه · تومان" value="۳۵٬۰۰۰٬۰۰۰" type /><Button>ثبت حساب و ادامه</Button></>;
    case "holdings": return <><Total label="ارزش سرمایه‌گذاری‌ها" value="۱۴۵٬۰۰۰٬۰۰۰" /><MoneyRow label="طلا" value="۶۰٬۰۰۰٬۰۰۰" /><MoneyRow label="صندوق" value="۵۰٬۰۰۰٬۰۰۰" /><MoneyRow label="رمزارز" value="۳۵٬۰۰۰٬۰۰۰" /><Button>ادامه به بدهی‌ها</Button></>;
    case "debt": return <><Field label="ماندهٔ وام شخصی · تومان" value="۵۵٬۰۰۰٬۰۰۰" type /><Field label="اقساط باقی‌مانده" value="۱۱ قسط ماهانه" /><MoneyRow label="مبلغ هر قسط" value="۵٬۰۰۰٬۰۰۰" /><Button>بررسی و تأیید</Button></>;
    case "review": return <><MoneyRow label="دارایی‌ها" value="۱۸۰٬۰۰۰٬۰۰۰" /><MoneyRow label="بدهی‌ها" value="۵۵٬۰۰۰٬۰۰۰" /><Total label="ارزش خالص اولیه" value="۱۲۵٬۰۰۰٬۰۰۰" /><Button>تأیید و ورود به توازن</Button></>;
    case "overview": return <><Total label="ارزش خالص شما" value="۱۲۵٬۰۰۰٬۰۰۰" /><MoneyRow label="دارایی‌ها" value="۱۸۰٬۰۰۰٬۰۰۰" /><MoneyRow label="بدهی‌ها" value="۵۵٬۰۰۰٬۰۰۰" /><div className="film-equation" data-reveal data-critical>دارایی − بدهی = ارزش خالص</div></>;
    case "budget": return <><div className="film-month" data-reveal><span data-critical>درآمد ماه: ۳۰ میلیون</span><span data-critical>خرج ماه: ۱۸ میلیون</span></div><div className="film-budget-card" data-reveal><b data-critical>خرید ماهانه</b><div className="film-budget-bar"><i data-bar /></div><MoneyRow label="خرج / سقف" value="۶ / ۸ میلیون" /><p data-critical>۲ میلیون تا سقف مانده</p></div></>;
    case "payment": return <><Field label="قسط ۱ — وام شخصی" value="۵٬۰۰۰٬۰۰۰ تومان" type /><Field label="پرداخت از" value="حساب روزمره · ملت" /><Button>ثبت پرداخت</Button><p className="film-payment-note" data-reveal>ثبت پرداخت انجام‌شده؛ بدون انتقال پول</p></>;
    case "paid": return <><div className="film-success" data-reveal><Icon name="check" size={48} /><b data-critical>پرداخت ثبت شد.</b></div><MoneyRow label="موجودی حساب" value="۳۰٬۰۰۰٬۰۰۰" changed="۳۵٬۰۰۰٬۰۰۰" /><MoneyRow label="ماندهٔ بدهی" value="۵۰٬۰۰۰٬۰۰۰" changed="۵۵٬۰۰۰٬۰۰۰" /><div className="film-equation" data-reveal data-critical>ارزش خالص: ۱۲۵ میلیون</div></>;
    case "portfolio": return <><Total label="ارزش سبد سرمایه‌گذاری" value="۱۴۵٬۰۰۰٬۰۰۰" /><div className="film-mix" data-reveal><div className="film-mix-bar"><i /><i /><i /></div><div className="film-mix-labels" data-critical><span>طلا <bdi dir="ltr">۴۱٪</bdi></span><span>صندوق <bdi dir="ltr">۳۵٪</bdi></span><span>رمزارز <bdi dir="ltr">۲۴٪</bdi></span></div></div><div className="film-portfolio-summary"><MoneyRow label="بهای خرید" value="۱۳۰٬۰۰۰٬۰۰۰" /><div className="film-profit" data-reveal><span data-critical>سود نمونه</span><b data-critical>۱۵ میلیون</b></div></div></>;
  }
}
export default function FilmScenes({ kind }: { kind: ProductFilmKind }) {
  const chapters = kind === "preview" ? PRODUCT_PREVIEW_CHAPTERS : PRODUCT_FILM_CHAPTERS;
  return <main className={`film-stage film-${kind}`} dir="rtl">
    <div className="film-top"><BrandMark size={40} /><b>توازن</b><span>{kind === "web" ? "نسخه وب" : kind === "pwa" ? "نسخه گوشی · PWA" : "پول و دارایی‌های شما، یک‌جا"}</span></div>
    <div className="film-progress">{chapters.map((c, i) => <span key={c.at}><i data-progress={i} /></span>)}</div>
    {chapters.map((chapter, step) => <section className="film-scene" data-scene={step} data-kind={chapter.scene} key={chapter.at}>
      <header className="film-heading"><h1 data-critical>{chapter.title}</h1></header>
      <div className="film-device"><div className="film-content"><Content scene={chapter.scene} /></div></div>
      {kind === "pwa" && step === 0 && <div className="film-launch" data-launch><div data-target><BrandMark size={130} framed /><b>توازن</b></div><p>باز کردن توازن از صفحهٔ اصلی</p></div>}
    </section>)}
    <div id="film-touch" aria-hidden="true" />
    <div id="film-cursor" aria-hidden="true"><svg width="48" height="58" viewBox="0 0 30 36"><path d="M3 2v28l7-7 6 11 5-3-6-11h11z" fill="var(--ink-900)" stroke="white" strokeWidth="2" /></svg></div>
    <footer>نمایش با داده‌های فرضی · مبالغ به تومان</footer>
  </main>;
}
