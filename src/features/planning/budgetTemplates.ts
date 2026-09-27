/**
 * الگوهای بودجه رویداد و پروژه — عقد، عروسی، تعویض ماشین…
 *
 * PURE and shared by the form and the page. A template only pre-fills a tag
 * budget (name, tag, suggested lines) and gives it a colour and an icon; the
 * money rules are the tag budget's own.
 */
import type { IconName } from "@/components/ui/Icon";

export type BudgetTemplateKey = "engagement" | "wedding" | "car" | "house" | "trip" | "renovation" | "custom";

export type BudgetTemplate = {
  key: BudgetTemplateKey;
  title: string;
  /** One line under the title in the picker. */
  hint: string;
  icon: IconName;
  /** Accent colour; the soft tints are derived from it in CSS. */
  tone: string;
  name: string;
  tag: string;
  /** Suggested lines (ریز اقلام) — the user keeps the ones they need. */
  items: string[];
  /** Months from today to the default end of the period. */
  months: number;
  /** Mostly a matter of SAVING money first — point to «هدف مالی» as well. */
  savings?: boolean;
};

export const BUDGET_TEMPLATES: BudgetTemplate[] = [
  {
    key: "engagement",
    title: "مراسم عقد",
    hint: "حلقه، طلا، لباس و محضر",
    icon: "ring",
    tone: "#c0841a",
    name: "مراسم عقد",
    tag: "عقد",
    items: ["حلقه", "سرویس طلا", "لباس", "آینه و شمعدان", "محضر", "تالار و پذیرایی", "عکس و فیلم", "خرید عقد"],
    months: 6,
  },
  {
    key: "wedding",
    title: "عروسی",
    hint: "تالار، لباس، آرایشگاه و تشریفات",
    icon: "heart",
    tone: "#d9577a",
    name: "عروسی",
    tag: "عروسی",
    items: ["تالار و پذیرایی", "لباس عروس و داماد", "آرایشگاه", "عکس و فیلم", "کارت دعوت", "ماشین عروس", "گل‌آرایی", "موسیقی", "جهیزیه"],
    months: 9,
  },
  {
    key: "car",
    title: "تعویض ماشین",
    hint: "مابه‌التفاوت، کارشناسی و انتقال سند",
    icon: "car",
    tone: "#3b6fd8",
    name: "تعویض ماشین",
    tag: "تعویض_ماشین",
    items: ["مابه‌التفاوت خرید", "کارشناسی", "انتقال سند و مالیات", "بیمه", "کمیسیون", "لوازم جانبی"],
    months: 6,
    savings: true,
  },
  {
    key: "house",
    title: "خانه بزرگ‌تر",
    hint: "پیش‌پرداخت، کمیسیون، اسباب‌کشی",
    icon: "home",
    tone: "#1f9d7a",
    name: "خانه بزرگ‌تر",
    tag: "خانه_جدید",
    items: ["پیش‌پرداخت", "کمیسیون مشاور املاک", "اسباب‌کشی", "نقاشی و تعمیرات", "وسایل جدید", "هزینه انتقال سند"],
    months: 12,
    savings: true,
  },
  {
    key: "trip",
    title: "سفر",
    hint: "بلیت، اقامت، خوراک و گشت",
    icon: "plane",
    tone: "#0f93b8",
    name: "سفر",
    tag: "سفر",
    items: ["بلیت", "اقامت", "خوراک", "گشت و تفریح", "سوغاتی"],
    months: 2,
  },
  {
    key: "renovation",
    title: "بازسازی خانه",
    hint: "مصالح، دستمزد، کابینت و نقاشی",
    icon: "hammer",
    tone: "#b8651f",
    name: "بازسازی خانه",
    tag: "بازسازی",
    items: ["مصالح", "دستمزد", "کابینت", "نقاشی", "کف‌پوش", "لوازم برقی"],
    months: 4,
  },
  {
    key: "custom",
    title: "دلخواه",
    hint: "هر رویداد یا پروژه دیگری",
    icon: "sparkle",
    tone: "#6b5bd2",
    name: "",
    tag: "",
    items: [],
    months: 3,
  },
];

const BY_KEY = new Map(BUDGET_TEMPLATES.map((t) => [t.key, t]));

export function budgetTemplate(key: string | null | undefined): BudgetTemplate | null {
  return (key && BY_KEY.get(key as BudgetTemplateKey)) || null;
}

export function isBudgetTemplateKey(key: string | null | undefined): key is BudgetTemplateKey {
  return !!key && BY_KEY.has(key as BudgetTemplateKey);
}
