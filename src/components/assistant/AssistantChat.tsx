"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import Icon from "@/components/ui/Icon";
import Markdown from "./Markdown";
import {
  decideProposalAction,
  deleteConversationAction,
  deleteMemoryAction,
  listConversationsAction,
  listMemoriesAction,
  loadConversationAction,
  renameConversationAction,
  updateMemoryAction,
} from "@/app/actions/assistant";
import type { ConversationSummary, Memory, MessageMeta, RecategorizeProposal, StoredMessage } from "@/features/assistant/store";
import type { FinancialSnapshot } from "@/features/assistant/snapshot";

const MARKER = "[[FOLLOWUPS]]";
const MAX_CHARS = 4000;

type UiMessage = {
  id: string;
  role: "user" | "model";
  content: string;
  meta: MessageMeta;
  pending?: boolean;
  error?: string;
};

type StarterCategory = "all" | "expenses_job" | "trading_invest" | "debts_purchases";

const STARTER_CATEGORIES: { id: StarterCategory; label: string; icon: "sparkle" | "briefcase" | "crypto" | "gift" }[] = [
  { id: "all", label: "همه سوالات تخصصی", icon: "sparkle" },
  { id: "expenses_job", label: "دسته‌های هزینه و شغل", icon: "briefcase" },
  { id: "trading_invest", label: "ترید و سرمایه‌گذاری", icon: "crypto" },
  { id: "debts_purchases", label: "بدهی‌ها و خریدهای آینده", icon: "gift" },
];

const OWNER_STARTER_CARDS = [
  {
    category: "expenses_job" as const,
    badge: "دسته‌های هزینه",
    icon: "receipt" as const,
    title: "تحلیل دسته‌های هزینه و نشتی‌ها",
    desc: "بررسی تنقلات، اشتراک‌ها و بهینه‌سازی هزینه‌های ماهانه",
    prompt: "دسته‌های هزینه‌ای من را تحلیل کن. کدام هزینه‌ها (مثل تنقلات، کافه یا اشتراک‌های خودکار) نشتی مالی محسوب می‌شوند و در شرایط فعلی که درآمد ثابت ندارم، چقدر و از چه بخش‌هایی باید هزینه‌های جاری‌ام را کاهش دهم تا دوره تاب‌آوری نقدی‌ام بیشتر شود؟",
  },
  {
    category: "expenses_job" as const,
    badge: "وضعیت شغلی",
    icon: "briefcase" as const,
    title: "قرارداد ۳ ماهه و ریسک بیکاری",
    desc: "سناریوی قرارداد موقت، ریسک بازگشت به بیکاری یا تمدید",
    prompt: "وضعیت شغلی من ممکن است یک قرارداد موقت ۳ ماهه باشد و بعد از ۳ ماه ممکن است دوباره بیکار شوم یا تمدید شود. چطور جریان مالی و تترها را فازبندی کنم که در صورت عدم تمدید به مشکل نخورم؟ و اگر در آینده درآمد یا هزینه‌هایم تغییر کرد چطور تحلیل‌ها را به‌روزرسانی کنم؟",
  },
  {
    category: "trading_invest" as const,
    badge: "ترید و جهش تتر",
    icon: "crypto" as const,
    title: "صعود تتر (۳۲۰ تا ۵۵۰ ه.ت) و ترید",
    desc: "جهش نرخ تتر تا سال بعد، سود سرمایه و حفظ اصل تترها",
    prompt: "ممکن است تا سال آینده قیمت تتر در ایران از ۳۲۰،۰۰۰ تومان تا ۳۷۰، ۴۲۰، ۴۵۰، ۵۰۰ یا ۵۵۰ هزار تومان صعود کند. چرا سود ترید درآمد نیست و این جهش نرخ چه کمکی به کاهش نیاز فروش تتر و تسویه بدهی‌ها می‌کند؟",
  },
  {
    category: "trading_invest" as const,
    badge: "سرمایه‌گذاری",
    icon: "portfolio" as const,
    title: "تخصیص دارایی و درآمد غیرفعال",
    desc: "توازن ثروت ۱۷٫۷ میلیاردی، اجاره املاک و پوشش تورم",
    prompt: "تحلیل جامع ترازنامه و ثروت خالص من (حدود ۱۷٫۷ میلیارد تومان): سبد دارایی من میان املاک، تتر، رمزارز و نقدینگی چطور توزیع شده است؟ برای ایجاد درآمد غیرفعال واقعی (مانند اجاره ملک یا سود استیبل‌کوین) و حفظ ارزش دارایی‌ها در برابر تورم چه راهکار مهندسی‌شده‌ای پیشنهاد می‌کنی؟",
  },
  {
    category: "trading_invest" as const,
    badge: "جبران تتر و PnL",
    icon: "crypto" as const,
    title: "جبران تترهای سوخته و سودآوری دلاری",
    desc: "محاسبه تترهای فروخته‌شده در بیت‌پین برای تنقلات و اقساط، و مثبت کردن سود دلاری سبد",
    prompt: "تترهایی که تاکنون برای هزینه‌های زندگی، تنقلات و اقساط فروخته شده و از تومان-بیت‌پین به حساب بانکی منتقل شده را بررسی کن. چطور این تترها را جبران کنم و چه برنامه‌ای برای بازخرید آن‌ها داشته باشم؟ همچنین برای سود و زیان تحقق‌نیافته دلاری سبد که منفی است چه استراتژی مهندسی‌شده‌ای پیاده کنم تا مثبت شود؟",
  },
  {
    category: "debts_purchases" as const,
    badge: "بدهی و اقساط",
    icon: "installments" as const,
    title: "بدهی‌ها و اقساط ۶ ماهه",
    desc: "بررسی کل بدهی ۴۵٫۹ میلیونی و اقساط بالای ۲ میلیون آبان به بعد",
    prompt: "کل بدهی‌های من حدود ۴۵٫۹ میلیون تومان است و برای ۶ ماه آینده (آبان تا اردیبهشت) بالای ۲ میلیون بدهی اقساطی دارم. لطفاً سررسیدها و مبلغ دقیق هر کدام را با راهکار تسویه از تتر یا درآمد به من نشان بده.",
  },
  {
    category: "debts_purchases" as const,
    badge: "خریدهای آینده",
    icon: "gift" as const,
    title: "جهیزیه، لوازم خانه و مراسم عقد",
    desc: "فازبندی ۲۸ قلم خرید ضروری، تفکیک طلا از هزینه‌های مصرفی",
    prompt: "من در ذهنم خریدهای بزرگی دارم که هنوز بودجه‌بندی نکرده‌ام (مانند خرید جاروبرقی، بخاری، پرده‌ها، اتو، کنسول، جاکفشی، کافه بار، لوستر، سرویس خواب، رگال لباس، حلقه، هزینه‌های عقد، طلا، تالار، شام و جهیزیه). چطور این هزینه‌ها را در ۳ فاز دسته‌بندی کنم، طلا را به عنوان حفظ سرمایه جدا کنم و با مدیریت فروش تتر تامین مالی کنم؟",
  },
  {
    category: "trading_invest" as const,
    badge: "تبدیل تتر",
    icon: "swap" as const,
    title: "صندوق مخارج تتر و چرخه نقد",
    desc: "محاسبه تتر موردنیاز برای فروش در بیت‌پین و واریز پایا",
    prompt: "چقدر نیاز دارم استیبل‌کوین (تتر) از بیت‌پین بفروشم و به تومان و حساب بانکی واریز کنم تا اقساط و هزینه‌های ماه‌های آینده‌ام تامین شود؟ چرخه گام‌به‌گام انتقال و نرخ بهینه تسویه را بگو.",
  },
  {
    category: "debts_purchases" as const,
    badge: "بیمه‌نامه",
    icon: "shield" as const,
    title: "بیمه شخص ثالث و تعهدات",
    desc: "بررسی وضعیت و مبلغ دقیق قسط ۹۰۹٬۰۹۰ تومانی بیمه",
    prompt: "وضعیت بیمه‌نامه‌ها و مبلغ دقیق قسط بیمه شخص ثالث من چقدر است و سررسید بعدی آن چه تاریخی است؟",
  },
];

export function buildDynamicStarterCards(s?: FinancialSnapshot | null) {
  const accounts = Array.isArray(s?.accounts) ? s.accounts : [];
  const byClass = Array.isArray(s?.netWorth?.byClass) ? s.netWorth.byClass : [];
  const topAssets = Array.isArray(s?.topAssets) ? s.topAssets : [];
  const debts = Array.isArray(s?.debts) ? s.debts : [];

  const hasTether =
    (s?.netWorth?.stablecoinToman ?? 0) > 0 ||
    accounts.some(
      (a) =>
        ["USDT", "USDC", "DAI"].includes(a?.currency ?? "") ||
        (typeof a?.name === "string" && a.name.includes("تتر")),
    );
  const hasCrypto =
    hasTether ||
    byClass.some((c) => c?.name?.includes("رمزارز") || c?.name?.toLowerCase().includes("crypto")) ||
    topAssets.some((a) => a?.className?.includes("رمزارز") || a?.className?.toLowerCase().includes("crypto"));

  const hasGold =
    byClass.some((c) => c?.name?.includes("طلا") || c?.name?.toLowerCase().includes("gold")) ||
    topAssets.some((a) => a?.className?.includes("طلا") || a?.className?.toLowerCase().includes("gold"));

  const hasStocks =
    byClass.some((c) => c?.name?.includes("سهام") || c?.name?.includes("بورس") || c?.name?.toLowerCase().includes("stock")) ||
    topAssets.some((a) => a?.className?.includes("سهام") || a?.className?.includes("بورس") || a?.className?.toLowerCase().includes("stock"));

  const hasRealEstate =
    byClass.some((c) => c?.name?.includes("ملک") || c?.name?.includes("املاک") || c?.name?.toLowerCase().includes("real")) ||
    topAssets.some((a) => a?.className?.includes("ملک") || a?.className?.includes("املاک"));

  const hasDebts = debts.length > 0 || (s?.netWorth?.totalDebtToman ?? 0) > 0;
  const hasIncome = (s?.cashflow?.avgMonthlyIncomeToman ?? 0) > 0 || (s?.cashflow?.currentMonth?.incomeToman ?? 0) > 0;

  const cards: typeof OWNER_STARTER_CARDS = [];

  // ۱. دسته‌های هزینه و نشتی‌ها
  cards.push({
    category: "expenses_job",
    badge: "دسته‌های هزینه",
    icon: "receipt",
    title: "تحلیل دسته‌های هزینه و نشتی‌ها",
    desc: "شناسایی هزینه‌های پرتکرار، اشتراک‌ها و راه‌های کاهش مخارج جاری",
    prompt: "دسته‌های هزینه‌ای من را بر اساس تراکنش‌های ثبت‌شده تحلیل کن. کدام هزینه‌ها بیشترین سهم را دارند و چطور می‌توانم هزینه‌های جاری و نشتی‌های مالی‌ام را کاهش دهم تا دوره تاب‌آوری نقدی‌ام بیشتر شود؟",
  });

  // ۲. وضعیت شغلی و جریان درآمد
  cards.push({
    category: "expenses_job",
    badge: hasIncome ? "امنیت درآمد و شغل" : "جریان درآمدی",
    icon: "briefcase",
    title: hasIncome ? "بودجه‌بندی حقوق و درآمد ماهانه" : "برنامه‌ریزی تنوع جریان درآمد",
    desc: hasIncome ? "تخصیص هوشمند درآمد ماهانه (قانون ۵۰/۳۰/۲۰) و پس‌انداز منظم" : "راهکارهای ایجاد درآمد پایدار و مدیریت جریان ورودی نقدی",
    prompt: hasIncome
      ? "جریان درآمد ماهانه من را بررسی کن. چطور حقوق و درآمدم را به شکل بهینه میان مخارج ضروری، پس‌انداز و سرمایه‌گذاری تقسیم کنم تا امنیت مالی بالاتری داشته باشم؟"
      : "وضعیت جریان درآمدی و نقدینگی مرا تحلیل کن. در شرایط کنونی چه استراتژی‌ای برای مدیریت مخارج و افزایش درآمدهای جدید پیشنهاد می‌کنی؟",
  });

  // ۳. کریپتو و تتر (تنها اگر کاربر رمزارز یا تتر داشته باشد)
  if (hasCrypto) {
    cards.push({
      category: "trading_invest",
      badge: hasTether ? "تتر و رمزارز" : "بازار رمزارز",
      icon: "crypto",
      title: hasTether ? "مدیریت استیبل‌کوین و پوشش ریسک ارزی" : "تحلیل دارایی‌های کریپتو و مدیریت ریسک",
      desc: hasTether ? "استراتژی تبدیل تتر، پوشش نوسان ارز و نقدشوندگی" : "بررسی پورتفوی رمزارز و استراتژی نوسان‌گیری یا هولد",
      prompt: hasTether
        ? "موجودی تتر و رمزارز مرا در برابر تورم و نوسان ارز تحلیل کن. چه زمان و به چه میزان برای هزینه‌ها تبدیل انجام دهم و چطور از اصل سرمایه محافظت کنم؟"
        : "وضعیت پورتفوی رمزارز مرا تحلیل کن. برای کنترل ریسک نوسانات و خروج به موقع به استیبل‌کوین یا تومان چه برنامه‌ای پیشنهاد می‌دهی؟",
    });
  }

  // ۴. طلا و مسکوکات (تنها در صورت داشتن طلا در سبد)
  if (hasGold) {
    cards.push({
      category: "trading_invest",
      badge: "طلا و مسکوکات",
      icon: "portfolio",
      title: "نقش طلا در سبد دارایی و حفظ ارزش",
      desc: "تحلیل بازدهی طلا در برابر تورم و استراتژی فروش یا حفظ",
      prompt: "دارایی‌های طلای من چه سهمی از کل ارزش خالص مرا تشکیل می‌دهند؟ در مقایسه با سایر بازارها، آیا افزایش سهم طلا یا صندوق‌های طلا را پیشنهاد می‌کنی؟",
    });
  }

  // ۵. بورس و سهام (تنها در صورت داشتن سهام)
  if (hasStocks) {
    cards.push({
      category: "trading_invest",
      badge: "بازار بورس",
      icon: "portfolio",
      title: "تنوع‌بخشی سهام و مدیریت بازدهی بورس",
      desc: "تحلیل عملکرد سبد بورسی، سود تقسیمی و مدیریت ریسک",
      prompt: "ترکیب سهام و صندوق‌های بورسی مرا بررسی کن. با توجه به شرایط اقتصادی، چه بازتنظیم (Rebalance) در سبد سهام پیشنهاد می‌کنی؟",
    });
  }

  // ۶. املاک (تنها در صورت داشتن ملک)
  if (hasRealEstate) {
    cards.push({
      category: "trading_invest",
      badge: "املاک و مستغلات",
      icon: "portfolio",
      title: "بازدهی املاک و جریان نقدی اجاره",
      desc: "بررسی سهم املاک در ثروت کل و بهینه‌سازی درآمد غیرفعال",
      prompt: "سهم املاک در ترازنامه مرا بررسی کن. چطور می‌توانم جریان نقدی غیرفعال (اجاره) را از این دارایی‌ها بهینه‌تر دریافت کنم؟",
    });
  }

  // اگر کاربر در هیچ بازار مالی (کریپتو، طلا، سهام) فعال نبود، یک کارت عمومی بدون ریسک نشان می‌دهیم
  if (!hasCrypto && !hasGold && !hasStocks) {
    cards.push({
      category: "trading_invest",
      badge: "سرمایه‌گذاری",
      icon: "portfolio",
      title: "حفظ ارزش پول و پس‌انداز کم‌ریسک",
      desc: "روش‌های مقابله با تورم از طریق صندوق‌های درآمد ثابت و پس‌انداز",
      prompt: "با توجه به اینکه در بازارهای پرریسک مالی فعال نیستم، بهترین راهکار برای حفظ ارزش پول نقد و پس‌انداز ماهانه‌ام در برابر تورم چیست؟",
    });
  }

  // ۷. صندوق نقدینگی و اضطراری بانکی
  cards.push({
    category: "expenses_job",
    badge: "صندوق اضطراری",
    icon: "briefcase",
    title: "ساخت صندوق اضطراری و تاب‌آوری مالی",
    desc: "محاسبه ۳ تا ۶ ماه مخارج ضروری برای سپر امن در برابر شوک‌های مالی",
    prompt: "با توجه به میانگین هزینه‌های ماهانه من، مبلغ ایده‌آل برای صندوق اضطراری من چقدر است و موجودی فعلی نقد من در بانک‌ها تا چند ماه پاسخگوی شرایط بحرانی است؟",
  });

  // ۸. بدهی‌ها و اقساط
  cards.push({
    category: "debts_purchases",
    badge: hasDebts ? "بدهی و اقساط" : "کنترل تعهدات",
    icon: "installments",
    title: hasDebts ? "مدیریت بدهی‌ها و اولویت‌بندی اقساط" : "استراتژی زندگی بدون بدهی",
    desc: hasDebts ? "بررسی سررسیدهای پیش‌رو و بهترین استراتژی تسویه بدهی‌ها" : "روش‌های استفاده بهینه از جریان نقدینگی بدون افتادن در تله بدهی",
    prompt: hasDebts
      ? "وضعیت بدهی‌ها و تعهدات اقساطی مرا بر اساس داده‌های ثبت‌شده بررسی کن. اولویت تسویه آنها چگونه باید باشد تا کمترین سود و فشار پرداخت شود؟"
      : "من بدهی ثبت‌شده‌ای ندارم؛ چطور این انضباط مالی را حفظ کنم و مازاد نقدی‌ام را بدون ایجاد تعهدات سنگین رشد دهم؟",
  });

  // ۹. خریدهای آینده
  cards.push({
    category: "debts_purchases",
    badge: "خریدهای آینده",
    icon: "gift",
    title: "برنامه‌ریزی و فازبندی خریدهای بزرگ",
    desc: "فازبندی اهداف مالی، برآورد هزینه و تامین مالی هدفمند",
    prompt: "من در ماه‌های آینده تصمیم به خریدهای ضروری و تجهیزاتی دارم. چطور این خریدها را فازبندی کنم، سقف بودجه تعیین کنم و بدون ایجاد کسری نقدینگی آنها را تامین مالی نمایم؟",
  });

  return cards;
}

const MEMORY_KIND: Record<string, string> = { goal: "هدف", preference: "ترجیح", constraint: "محدودیت", fact: "واقعیت" };

const visible = (text: string) => {
  const i = text.indexOf(MARKER);
  return i < 0 ? text : text.slice(0, i);
};
const fa = (n: number) => Math.round(n).toLocaleString("fa-IR");

export default function AssistantChat({
  configured,
  initialConversations,
  initialMemories,
  isOwner = false,
  s = null,
}: {
  configured: boolean;
  initialConversations: ConversationSummary[];
  initialMemories: Memory[];
  isOwner?: boolean;
  s?: FinancialSnapshot | null;
}) {
  const starterCards = isOwner ? OWNER_STARTER_CARDS : buildDynamicStarterCards(s);
  const [conversations, setConversations] = useState(initialConversations);
  const [memories, setMemories] = useState(initialMemories);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [input, setInput] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loadingConv, setLoadingConv] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [showMemory, setShowMemory] = useState(false);
  const [starterCategory, setStarterCategory] = useState<StarterCategory>("all");
  const [, startTransition] = useTransition();
  const abortRef = useRef<AbortController | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, status]);

  const refreshLists = useCallback(() => {
    startTransition(async () => {
      const [c, m] = await Promise.all([listConversationsAction(), listMemoriesAction()]);
      if (c.ok) setConversations(c.data);
      if (m.ok) setMemories(m.data);
    });
  }, []);

  const openConversation = useCallback(async (id: string) => {
    abortRef.current?.abort();
    setActiveId(id);
    setEditingId(null);
    setShowHistory(false);
    setLoadingConv(true);
    const res = await loadConversationAction(id);
    setLoadingConv(false);
    if (res.ok) setMessages(res.data.map((m: StoredMessage) => ({ id: m.id, role: m.role, content: m.content, meta: m.meta })));
    else setNotice(res.message);
  }, []);

  const newConversation = useCallback(() => {
    abortRef.current?.abort();
    setActiveId(null);
    setMessages([]);
    setEditingId(null);
    setInput("");
    setShowHistory(false);
    inputRef.current?.focus();
  }, []);

  const send = useCallback(
    async (text: string, opts: { editId?: string | null } = {}) => {
      const message = text.trim();
      if (!message || busy) return;
      if (!configured) {
        setNotice("گفتگو با دستیار فعلاً در دسترس نیست.");
        return;
      }
      setNotice(null);
      setBusy(true);
      setStatus("در حال ارسال…");
      setInput("");
      setEditingId(null);
      const tempUser = `tmp-u-${Date.now()}`;
      const tempModel = `tmp-m-${Date.now()}`;
      setMessages((prev) => {
        const base = opts.editId ? prev.slice(0, Math.max(0, prev.findIndex((m) => m.id === opts.editId))) : prev;
        return [...base, { id: tempUser, role: "user", content: message, meta: {} }, { id: tempModel, role: "model", content: "", meta: {}, pending: true }];
      });

      const controller = new AbortController();
      abortRef.current = controller;
      let conversationId = activeId;
      try {
        const res = await fetch("/api/assistant/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message, conversationId: activeId, editMessageId: opts.editId ?? null }),
          signal: controller.signal,
        });
        if (!res.ok || !res.body) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err?.error || "ارسال پیام ناموفق بود.");
        }
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let nl: number;
          while ((nl = buffer.indexOf("\n")) >= 0) {
            const line = buffer.slice(0, nl).trim();
            buffer = buffer.slice(nl + 1);
            if (!line) continue;
            const ev = JSON.parse(line);
            if (ev.type === "meta") {
              conversationId = ev.conversationId;
              setActiveId(ev.conversationId);
            } else if (ev.type === "status") setStatus(ev.label);
            else if (ev.type === "text") {
              setStatus(null);
              setMessages((prev) => prev.map((m) => (m.id === tempModel ? { ...m, content: m.content + ev.delta } : m)));
            } else if (ev.type === "reset") {
              setMessages((prev) => prev.map((m) => (m.id === tempModel ? { ...m, content: ev.content } : m)));
            } else if (ev.type === "done") {
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === tempModel
                    ? { id: ev.messageId, role: "model", content: ev.content, meta: { suggestions: ev.suggestions, proposals: ev.proposals, model: ev.model } }
                    : m,
                ),
              );
            } else if (ev.type === "error") {
              setMessages((prev) => prev.map((m) => (m.id === tempModel ? { ...m, pending: false, error: ev.message } : m)));
            }
          }
        }
      } catch (e) {
        if (controller.signal.aborted) {
          setMessages((prev) => prev.map((m) => (m.id === tempModel ? { ...m, pending: false, error: "متوقف شد." } : m)));
        } else {
          setMessages((prev) => prev.map((m) => (m.id === tempModel ? { ...m, pending: false, error: e instanceof Error ? e.message : "خطا" } : m)));
        }
      } finally {
        setBusy(false);
        setStatus(null);
        abortRef.current = null;
        // Real ids for the user message (edit needs them) come from the server.
        if (conversationId) {
          const fresh = await loadConversationAction(conversationId);
          if (fresh.ok && fresh.data.length) {
            setMessages((prev) => {
              const errors = prev.filter((m) => m.error && m.role === "model" && !fresh.data.some((d) => d.id === m.id));
              const stored: UiMessage[] = fresh.data.map((m) => ({ id: m.id, role: m.role, content: m.content, meta: m.meta }));
              return errors.length ? [...stored, ...errors.map((m) => ({ ...m, pending: false }))] : stored;
            });
          }
        }
        refreshLists();
      }
    },
    [activeId, busy, configured, refreshLists],
  );

  // Questions handed over from the dashboard («از دستیار بپرس»).
  useEffect(() => {
    const onAsk = (e: Event) => {
      const q = (e as CustomEvent<string>).detail;
      if (typeof q === "string" && q.trim()) send(q);
    };
    window.addEventListener("assistant:ask", onAsk);
    return () => window.removeEventListener("assistant:ask", onAsk);
  }, [send]);

  const decide = async (messageId: string, p: RecategorizeProposal, decision: "apply" | "dismiss") => {
    const res = await decideProposalAction(messageId, p.id, decision);
    setNotice(res.message ?? null);
    if (res.ok) {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === messageId
            ? { ...m, meta: { ...m.meta, proposals: m.meta.proposals?.map((x) => (x.id === p.id ? { ...x, status: decision === "apply" ? "applied" : "dismissed" } : x)) } }
            : m,
        ),
      );
    }
  };

  const lastUserId = [...messages].reverse().find((m) => m.role === "user")?.id;
  const lastModel = [...messages].reverse().find((m) => m.role === "model" && !m.pending && !m.error);

  return (
    <div className="ai-chat">
      <div className="ai-chat-bar">
        <button type="button" className="ai-pill is-primary" onClick={newConversation}>
          <Icon name="plus" size={14} /> گفتگوی تازه
        </button>
        <button type="button" className="ai-pill" onClick={() => setShowHistory((v) => !v)} aria-expanded={showHistory}>
          <Icon name="clock" size={14} /> گفتگوهای قبلی{conversations.length ? ` (${fa(conversations.length)})` : ""}
        </button>
        <button type="button" className="ai-pill" onClick={() => setShowMemory((v) => !v)} aria-expanded={showMemory}>
          <Icon name="note" size={14} /> آنچه دستیار به خاطر دارد{memories.length ? ` (${fa(memories.length)})` : ""}
        </button>
      </div>

      {showHistory && (
        <div className="card ai-panel">
          {conversations.length === 0 ? (
            <p className="muted text-[length:var(--fs-xs)]">هنوز گفتگویی ذخیره نشده است.</p>
          ) : (
            <ul role="list" className="ai-conv-list">
              {conversations.map((c) => (
                <li key={c.id} className={c.id === activeId ? "is-active" : undefined}>
                  <button type="button" className="ai-conv-open" onClick={() => openConversation(c.id)} dir="auto">
                    <span className="truncate">{c.title}</span>
                    <span className="muted text-[length:var(--fs-micro)]">{new Date(c.updatedAt).toLocaleDateString("fa-IR")}</span>
                  </button>
                  <button
                    type="button"
                    className="ai-icon-btn"
                    aria-label="تغییر نام"
                    onClick={async () => {
                      const t = window.prompt("نام تازه‌ی گفتگو", c.title);
                      if (t == null) return;
                      await renameConversationAction(c.id, t);
                      refreshLists();
                    }}
                  >
                    <Icon name="note" size={14} />
                  </button>
                  <button
                    type="button"
                    className="ai-icon-btn"
                    aria-label="حذف گفتگو"
                    onClick={async () => {
                      if (!window.confirm("این گفتگو برای همیشه حذف شود؟")) return;
                      await deleteConversationAction(c.id);
                      if (c.id === activeId) newConversation();
                      refreshLists();
                    }}
                  >
                    <Icon name="trash" size={14} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {showMemory && (
        <div className="card ai-panel">
          <p className="muted mb-2 text-[length:var(--fs-xs)] leading-5">
            نکته‌هایی که در گفتگو گفته‌اید (هدف‌ها، ترجیح‌ها، محدودیت‌ها). اعداد مالی هر بار تازه از داده‌های شما خوانده می‌شوند، نه از این فهرست.
          </p>
          {memories.length === 0 ? (
            <p className="muted text-[length:var(--fs-xs)]">چیزی ذخیره نشده است.</p>
          ) : (
            <ul role="list" className="ai-conv-list">
              {memories.map((m) => (
                <li key={m.id}>
                  <span className="ai-mem-kind">{MEMORY_KIND[m.kind] ?? m.kind}</span>
                  <span className="min-w-0 flex-1 text-[length:var(--fs-sm)]" dir="auto">{m.content}</span>
                  <button
                    type="button"
                    className="ai-icon-btn"
                    aria-label="ویرایش"
                    onClick={async () => {
                      const t = window.prompt("اصلاح یادداشت", m.content);
                      if (t == null) return;
                      await updateMemoryAction(m.id, t);
                      refreshLists();
                    }}
                  >
                    <Icon name="note" size={14} />
                  </button>
                  <button
                    type="button"
                    className="ai-icon-btn"
                    aria-label="حذف"
                    onClick={async () => {
                      await deleteMemoryAction(m.id);
                      refreshLists();
                    }}
                  >
                    <Icon name="trash" size={14} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="ai-thread" aria-live="polite">
        {loadingConv && <p className="muted text-[length:var(--fs-sm)]">در حال بارگذاری گفتگو…</p>}
        {!loadingConv && messages.length === 0 && (
          <div className="ai-empty">
            <div className="ai-empty-avatar" aria-hidden="true">
              <Icon name="sparkle" size={26} />
            </div>
            <h2 className="ai-empty-title">دستیار هوشمند توازن</h2>
            <p className="ai-empty-desc">
              تحلیل و پاسخ‌گویی بر اساس داده‌های زنده و واقعی حساب‌ها، هزینه‌ها، وضعیت شغلی، ترید و سود سرمایه، بدهی‌ها و بودجه‌های شما.
            </p>
            <div className="ai-starters-tabs" role="tablist" aria-label="دسته‌بندی موضوعات">
              {STARTER_CATEGORIES.map((cat) => (
                <button
                  key={cat.id}
                  type="button"
                  role="tab"
                  aria-selected={starterCategory === cat.id}
                  className={`ai-starters-tab ${starterCategory === cat.id ? "is-active" : ""}`}
                  onClick={() => setStarterCategory(cat.id)}
                >
                  <Icon name={cat.icon} size={13} />
                  <span>{cat.label}</span>
                  <span className="ai-tab-count num">
                    {fa(cat.id === "all" ? starterCards.length : starterCards.filter((c) => c.category === cat.id).length)}
                  </span>
                </button>
              ))}
            </div>
            <div className="ai-starters-grid">
              {starterCards.filter((c) => starterCategory === "all" || c.category === starterCategory).map((c) => (
                <button
                  key={c.title}
                  type="button"
                  className="ai-starter-card"
                  onClick={() => send(c.prompt)}
                  disabled={busy || !configured}
                >
                  <div className="ai-starter-icon">
                    <Icon name={c.icon} size={18} />
                  </div>
                  <div className="ai-starter-text">
                    <div className="ai-starter-head">
                      <b className="ai-starter-title">{c.title}</b>
                      <span className="ai-starter-badge">{c.badge}</span>
                    </div>
                    <span className="ai-starter-desc">{c.desc}</span>
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m) => (
          <div key={m.id} className={`ai-msg ai-msg-${m.role}`}>
            {m.role === "user" ? (
              <div className="ai-user-wrap">
                <div className="ai-bubble" dir="auto">
                  {m.content}
                </div>
                {m.id === lastUserId && !busy && !m.id.startsWith("tmp-") && (
                  <button
                    type="button"
                    className="ai-edit-btn"
                    onClick={() => {
                      setEditingId(m.id);
                      setInput(m.content);
                      inputRef.current?.focus();
                    }}
                  >
                    <Icon name="note" size={11} />
                    <span>ویرایش پیام</span>
                  </button>
                )}
              </div>
            ) : (
              <div className="ai-answer">
                <div className="ai-model-header">
                  <div className="ai-avatar" aria-hidden="true">
                    <Icon name="sparkle" size={13} />
                  </div>
                  <span className="ai-model-name">دستیار هوشمند</span>
                  {m.meta.model && <span className="ai-model-tag" dir="ltr">{m.meta.model}</span>}
                </div>
                <div className="ai-answer-body">
                  {m.content ? <Markdown text={visible(m.content)} /> : null}
                  {m.pending && !m.content && (
                    <div className="ai-status">
                      <span className="ai-dots" aria-hidden="true"><i /><i /><i /></span>
                      <span>{status ?? "در حال تحلیل و تنظیم پاسخ…"}</span>
                    </div>
                  )}
                  {m.pending && m.content && status && (
                    <div className="ai-status is-streaming">
                      <span className="ai-dots" aria-hidden="true"><i /><i /><i /></span>
                      <span className="muted">{status}</span>
                    </div>
                  )}
                  {m.error && (
                    <div className="ai-error" role="alert">
                      <Icon name="alert" size={14} /> {m.error}
                    </div>
                  )}
                </div>
                {(m.meta.proposals ?? []).length > 0 && (
                  <div className="ai-proposals">
                    <p className="muted text-[length:var(--fs-xs)]">پیشنهاد اصلاح دسته‌بندی — تا تأیید نکنید چیزی تغییر نمی‌کند:</p>
                    {m.meta.proposals!.map((p) => (
                      <div key={p.id} className="ai-proposal">
                        <div className="min-w-0 flex-1">
                          <b className="block truncate text-[length:var(--fs-sm)]" dir="auto">{p.description || "بدون شرح"}</b>
                          <span className="muted block text-[length:var(--fs-xs)]">
                            {p.entryDate ? new Date(p.entryDate).toLocaleDateString("fa-IR") : ""} · {fa(p.amountToman)} تومان · {p.fromCategory ?? "بدون دسته"} ← <b>{p.toCategoryName}</b> · اطمینان {fa(p.confidence * 100)}٪
                          </span>
                          {p.reason && <span className="muted block text-[length:var(--fs-xs)]" dir="auto">{p.reason}</span>}
                        </div>
                        {p.status === "pending" ? (
                          <div className="flex shrink-0 gap-1.5">
                            <button type="button" className="btn btn-primary !min-h-8 !px-3 text-[length:var(--fs-xs)]" onClick={() => decide(m.id, p, "apply")}>
                              اعمال
                            </button>
                            <button type="button" className="btn btn-ghost !min-h-8 !px-2 text-[length:var(--fs-xs)]" onClick={() => decide(m.id, p, "dismiss")}>
                              رد
                            </button>
                          </div>
                        ) : (
                          <span className="muted shrink-0 text-[length:var(--fs-xs)]">{p.status === "applied" ? "اعمال شد ✓" : "رد شد"}</span>
                        )}
                      </div>
                    ))}
                  </div>
                )}
                {!m.pending && m.content && (
                  <div className="ai-tools">
                    <button type="button" className="ai-link" onClick={() => navigator.clipboard?.writeText(visible(m.content))}>
                      <Icon name="copy" size={12} /> کپی پاسخ
                    </button>
                  </div>
                )}
                {m === lastModel && !busy && (m.meta.suggestions ?? []).length > 0 && (
                  <div className="ai-chips">
                    {m.meta.suggestions!.map((s) => (
                      <button key={s} type="button" className="ai-chip-btn" onClick={() => send(s)} dir="auto">
                        <Icon name="sparkle" size={11} />
                        <span>{s}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
        <div ref={endRef} />
      </div>

      {notice && (
        <p className="ai-notice" role="status">
          {notice}
          <button type="button" className="ai-icon-btn" aria-label="بستن" onClick={() => setNotice(null)}>
            <Icon name="x" size={12} />
          </button>
        </p>
      )}

      <form
        className="ai-composer"
        onSubmit={(e) => {
          e.preventDefault();
          send(input, { editId: editingId });
        }}
      >
        {editingId && (
          <div className="ai-editing">
            ویرایش آخرین پیام — پاسخ قبلی جایگزین می‌شود.
            <button type="button" className="ai-link" onClick={() => { setEditingId(null); setInput(""); }}>
              انصراف
            </button>
          </div>
        )}
        <textarea
          ref={inputRef}
          className="ai-input"
          value={input}
          dir="auto"
          rows={1}
          maxLength={MAX_CHARS}
          placeholder={configured ? "سؤالتان را بنویسید… (Enter ارسال، Shift+Enter خط تازه)" : "گفتگو فعلاً در دسترس نیست."}
          disabled={!configured}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              send(input, { editId: editingId });
            }
          }}
        />
        {busy ? (
          <button type="button" className="ai-send is-stop" onClick={() => abortRef.current?.abort()} aria-label="توقف">
            <Icon name="x" size={18} />
          </button>
        ) : (
          <button type="submit" className="ai-send" disabled={!input.trim() || !configured} aria-label="ارسال">
            <Icon name="send" size={18} />
          </button>
        )}
      </form>
      <p className="muted mt-1.5 text-[length:var(--fs-micro)] leading-4">
        پاسخ‌ها با هوش مصنوعی (Gemini) و بر پایه‌ی داده‌های ثبت‌شده‌ی شما ساخته می‌شوند؛ ممکن است خطا داشته باشند و جایگزین مشاور مالی نیستند.
      </p>
    </div>
  );
}
