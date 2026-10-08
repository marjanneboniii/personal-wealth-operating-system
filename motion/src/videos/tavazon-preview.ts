import { defineVideo } from "../engine/spec";

/**
 * Landing-page preview (20s). Scene timings must match
 * PRODUCT_PREVIEW_CHAPTERS in src/lib/productFilms.ts: the topic buttons seek
 * to 0s, 8s and 16s. All figures are fictional and internally consistent:
 * 180 assets − 55 debt = 125 net worth; paying a 5M installment lowers cash
 * and debt by 5M each and leaves net worth at 125; the portfolio is
 * 130 cost + 15 unrealized gain = 145 (60 gold, 50 fund, 35 crypto).
 */
export default defineVideo({
  id: "tavazon-preview",
  title: "توازن — نمایش کوتاه",
  footnote: "نمایش با داده‌های فرضی",
  scenes: [
    {
      template: "stat",
      seconds: 4,
      chapter: "overview",
      props: {
        copy: { eyebrow: "تصویر مالی شما", headline: "همهٔ پول و دارایی‌تان، *یک‌جا.*", body: "حساب‌ها، دارایی‌ها و بدهی‌ها کنار هم." },
        hero: { label: "ارزش خالص", amount: 125, unit: "میلیون تومان", icon: "networth" },
        rows: [
          { label: "دارایی‌ها", amount: 180, unit: "میلیون", tone: "positive" },
          { label: "بدهی‌ها", amount: 55, unit: "میلیون", tone: "negative" },
        ],
      },
    },
    {
      template: "meter",
      seconds: 4,
      chapter: "budget",
      props: {
        copy: { eyebrow: "خرج ماه", headline: "خرج ماه، *زیر نظر* شما.", body: "پیش از رسیدن به سقف بودجه باخبر می‌شوید." },
        title: "بودجهٔ خرید ماهانه",
        icon: "budgets",
        used: 6,
        limit: 8,
        unit: "میلیون",
        usedLabel: "خرج‌شده تا امروز · میلیون تومان",
        remaining: "۲ میلیون تا سقف بودجه مانده",
      },
    },
    {
      template: "action",
      seconds: 4,
      chapter: "payment",
      props: {
        copy: { eyebrow: "ثبت پرداخت قسط", headline: "قسط را دادید؟ *ثبتش کنید.*" },
        title: "قسط ۱ · وام شخصی",
        icon: "installments",
        fields: [
          { label: "مبلغ", value: "۵ میلیون تومان" },
          { label: "پرداخت از", value: "حساب روزمره · ملت" },
        ],
        button: "ثبت پرداخت",
        note: "فقط ثبت می‌شود؛ پولی جابه‌جا نمی‌شود.",
      },
    },
    {
      template: "delta",
      seconds: 4,
      chapter: "paid",
      props: {
        copy: { eyebrow: "نتیجهٔ ثبت", headline: "حساب و بدهی، *با هم* به‌روز شدند." },
        badge: "پرداخت ثبت شد",
        rows: [
          { label: "موجودی حساب", from: 35, to: 30, unit: "میلیون" },
          { label: "ماندهٔ بدهی", from: 55, to: 50, unit: "میلیون", tone: "positive" },
        ],
        steady: { label: "ارزش خالص ثابت ماند", amount: 125, unit: "میلیون" },
      },
    },
    {
      template: "mix",
      seconds: 4,
      chapter: "portfolio",
      props: {
        copy: { eyebrow: "سبد سرمایه‌گذاری", headline: "سرمایه‌تان، *در یک نگاه.*" },
        total: { label: "ارزش سبد · بهای خرید ۱۳۰ میلیون تومان", amount: 145, unit: "میلیون تومان" },
        segments: [
          { label: "طلا", share: 60 / 145, tone: "gold" },
          { label: "صندوق", share: 50 / 145, tone: "sky" },
          { label: "رمزارز", share: 35 / 145, tone: "violet" },
        ],
        highlight: { label: "سود تحقق‌نیافته", amount: 15, unit: "میلیون تومان", tone: "positive" },
      },
    },
  ],
});
