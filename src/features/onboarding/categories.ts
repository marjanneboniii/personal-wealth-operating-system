/**
 * Checklist vocabulary and decision logic — deliberately DATABASE-FREE.
 *
 * The wizard is a client component. Importing the service module (which talks
 * to the database) from it dragged `pg` — and therefore node:dns — into the
 * browser bundle and broke the build. Splitting is not just a build fix: the
 * decision functions below are pure, and keeping them pure is what lets them
 * be tested exhaustively without a database.
 */
/** The six categories the checklist asks about, in the order it asks. */
export const ASSET_CATEGORIES = [
  "real_estate",
  "vehicle",
  "crypto",
  "fund",
  "online_gold",
  "stock",
] as const;

export type AssetCategory = (typeof ASSET_CATEGORIES)[number];

export type IntentAnswer = "yes" | "no";

/**
 * Persian labels and the one-line prompt each card asks. The prompt is phrased
 * as a plain question about ownership, never as a feature pitch — the user is
 * answering about their own life, not choosing a module.
 */
export const CATEGORY_META: Record<
  AssetCategory,
  { label: string; question: string; hint: string; href: string }
> = {
  real_estate: {
    label: "ملک",
    question: "ملکی دارید؟",
    hint: "آپارتمان، زمین، مغازه یا دفتر کار — چند مورد هم می‌توانید ثبت کنید.",
    href: "/asset-registry?kind=real-estate",
  },
  vehicle: {
    label: "خودرو",
    question: "خودرویی دارید؟",
    hint: "سواری، وانت یا موتورسیکلت — اگر بیش از یکی دارید، همه را اضافه کنید.",
    href: "/asset-registry?kind=vehicle",
  },
  crypto: {
    label: "رمزارز",
    question: "رمزارزی دارید؟",
    hint: "در هر صرافی یا کیف پولی — نوبیتکس، والکس، کیف پول سرد یا گرم.",
    href: "/crypto",
  },
  fund: {
    label: "صندوق سرمایه‌گذاری",
    question: "در صندوقی سرمایه‌گذاری کرده‌اید؟",
    hint: "درآمد ثابت، قابل معامله (ETF) یا صندوق طلا مانند کهربا، عیار و گوهر.",
    href: "/assets/financial",
  },
  online_gold: {
    label: "طلای آب‌شده آنلاین",
    question: "طلای آب‌شده آنلاین خریده‌اید؟",
    hint: "ملی‌گلد، میلی، طلاسی، تکنوگلد، دیجی‌کالا گلد یا طلاین.",
    href: "/assets",
  },
  stock: {
    label: "سهام بورسی",
    question: "سهام بورسی یا فرابورسی دارید؟",
    hint: "نمادهای بورس و فرابورس تهران.",
    href: "/assets/financial",
  },
};

export function isAssetCategory(value: string): value is AssetCategory {
  return (ASSET_CATEGORIES as readonly string[]).includes(value);
}

export type IntentRow = {
  category: AssetCategory;
  answer: IntentAnswer;
  answeredAt: string;
  itemsAtAnswer: number;
  reminderDismissedAt: string | null;
};

export type ChecklistStatus = {
  /** Categories with no answer yet — the checklist is not finished. */
  unanswered: AssetCategory[];
  /** Said «بله» but has registered nothing since. The actionable gap. */
  promisedButEmpty: AssetCategory[];
  /** Every category has an answer. */
  complete: boolean;
};

/**
 * Compare the user's claims against what is actually registered.
 *
 * `counts` is supplied by the caller rather than queried here, so this stays a
 * pure decision function: each category counts its own assets through its own
 * module, and this file does not grow a dependency on all six of them.
 */
export function evaluateChecklist(
  intents: readonly IntentRow[],
  counts: Partial<Record<AssetCategory, number>>,
): ChecklistStatus {
  const byCategory = new Map(intents.map((i) => [i.category, i]));
  const unanswered: AssetCategory[] = [];
  const promisedButEmpty: AssetCategory[] = [];

  for (const category of ASSET_CATEGORIES) {
    const intent = byCategory.get(category);
    if (!intent) {
      unanswered.push(category);
      continue;
    }
    if (intent.answer !== "yes") continue;
    if (intent.reminderDismissedAt) continue;
    if ((counts[category] ?? 0) > 0) continue;
    promisedButEmpty.push(category);
  }

  return { unanswered, promisedButEmpty, complete: unanswered.length === 0 };
}

/** How long after answering «بله» a still-empty category earns a nudge. */
export const REMINDER_DELAY_DAYS = 3;

/**
 * The soft follow-up (بخش ۲، بند ۴). Only fires for a category the user said
 * they HAVE and then never registered, and only after a grace period — nudging
 * someone an hour after they said «بله» is noise, not a reminder.
 */
export function pendingReminders(
  intents: readonly IntentRow[],
  counts: Partial<Record<AssetCategory, number>>,
  now: Date = new Date(),
): AssetCategory[] {
  const { promisedButEmpty } = evaluateChecklist(intents, counts);
  const byCategory = new Map(intents.map((i) => [i.category, i]));
  const cutoffMs = REMINDER_DELAY_DAYS * 24 * 60 * 60 * 1000;

  return promisedButEmpty.filter((category) => {
    const answeredAt = byCategory.get(category)?.answeredAt;
    if (!answeredAt) return false;
    return now.getTime() - new Date(answeredAt).getTime() >= cutoffMs;
  });
}
