import { sql } from "drizzle-orm";
import { db } from "@/db";

/**
 * Financial Integrity — the "can I trust these numbers?" engine.
 * Every check answers in human language, reports affected records,
 * and points to a resolution. No raw error codes, ever.
 */

export type CheckStatus = "pass" | "warn" | "fail";

export type IntegrityCheck = {
  id: string;
  title: string;
  description: string;
  status: CheckStatus;
  /** human summary of the outcome */
  outcome: string;
  affected: number;
  samples: string[];
  severityLabel: string;
  action?: { href: string; label: string };
  ranAt: string;
};

async function rows<T>(query: ReturnType<typeof sql>): Promise<T[]> {
  const res = await db.execute(query);
  return res.rows as T[];
}

export async function runIntegrityChecks(): Promise<IntegrityCheck[]> {
  const ranAt = new Date().toISOString();

  const [unbalanced, incomplete, fifoBad, orphanLinks, stalePrices, duplicates, unreviewed] = await Promise.all([
    // 1. Ledger balance — every journal entry must sum to zero
    rows<{ id: string; description: string; entry_date: string }>(sql`
      select je.id, je.description, je.entry_date::text
      from journal_entries je
      join postings p on p.entry_id = je.id
      group by je.id
      having abs(sum(p.base_value)) > 0.000000001
      limit 10
    `),
    // 2. Structural completeness — every entry needs at least two postings
    rows<{ id: string; description: string; entry_date: string }>(sql`
      select je.id, je.description, je.entry_date::text
      from journal_entries je
      left join postings p on p.entry_id = je.id
      group by je.id
      having count(p.id) < 2
      limit 10
    `),
    // 3. FIFO lot consistency — opened = remaining + consumed, per lot
    rows<{ symbol: string; opened_at: string }>(sql`
      select ast.symbol, l.opened_at::text
      from lots l
      join assets ast on ast.id = l.asset_id
      where abs(
        l.qty_opened - l.qty_remaining -
        coalesce((select sum(lc.quantity) from lot_consumptions lc where lc.lot_id = l.id), 0)
      ) > 0.00000001
      limit 10
    `),
    // 4. Planning ↔ ledger linkage — paid installments must reference their entry
    rows<{ title: string; seq: number; due_date: string }>(sql`
      select d.title, i.seq, i.due_date::text
      from installments i
      join debts d on d.id = i.debt_id
      where i.status = 'paid' and i.paid_entry_id is null
      limit 10
    `),
    // 5. Valuation coverage — every held asset needs a price in the last 30 days
    rows<{ symbol: string; name: string; last_price: string | null }>(sql`
      with held as (
        select p.asset_id
        from postings p
        join journal_entries je on je.id = p.entry_id
        join accounts a on a.id = p.account_id
        where je.status = 'posted' and a.type = 'asset'
        group by p.asset_id
        having abs(sum(p.quantity)) > 0.00000001
      )
      select ast.symbol, ast.name, max(pr.as_of)::text as last_price
      from held h
      join assets ast on ast.id = h.asset_id
      left join prices pr on pr.asset_id = h.asset_id
      group by ast.id, ast.symbol, ast.name
      having max(pr.as_of) is null or max(pr.as_of) < current_date - interval '30 days'
      limit 10
    `),
    // 6. Duplicates — same day, same description, posted twice (last year)
    rows<{ description: string; entry_date: string; c: string }>(sql`
      select je.description, je.entry_date::text, count(*)::text as c
      from journal_entries je
      where je.status = 'posted'
        and je.entry_date >= current_date - interval '365 days'
        and coalesce(je.reversal_of::text, '') = ''
      group by je.description, je.entry_date
      having count(*) > 1
      limit 10
    `),
    // 7. Review coverage — imported records awaiting human confirmation
    rows<{ id: string; description: string; entry_date: string }>(sql`
      select je.id, je.description, je.entry_date::text
      from journal_entries je
      where je.source = 'import' and je.status = 'posted'
        and not exists (select 1 from entry_reviews er where er.entry_id = je.id)
      limit 10
    `),
  ]);

  const ago = (iso: string | null) => (iso ? iso.slice(0, 10) : "—");

  return [
    {
      id: "ledger-balance",
      title: "تراز دفترکل",
      description: "در حسابداری دوطرفه، مجموع بدهکار و بستانکار هر سند باید دقیقاً صفر باشد. این بررسی هر سند را جمع می‌زند.",
      status: unbalanced.length ? "fail" : "pass",
      outcome: unbalanced.length
        ? `${unbalanced.length} سند نامتوازن پیدا شد — مانده‌های مشتق‌شده قابل اتکا نیستند تا زمانی که اصلاح شوند.`
        : "همه اسناد کاملاً تراز هستند؛ مانده‌ها از دفتری سالم مشتق می‌شوند.",
      affected: unbalanced.length,
      samples: unbalanced.map((r) => `${r.description} — ${ago(r.entry_date)}`),
      severityLabel: unbalanced.length ? "بحرانی" : "سالم",
      action: unbalanced.length ? { href: "/ledger", label: "مشاهده در دفترکل" } : undefined,
      ranAt,
    },
    {
      id: "record-completeness",
      title: "کامل بودن اسناد",
      description: "هر سند باید حداقل دو ردیف (بدهکار و بستانکار) داشته باشد؛ اسناد ناقص نشانه ثبت نیمه‌کاره هستند.",
      status: incomplete.length ? "fail" : "pass",
      outcome: incomplete.length
        ? `${incomplete.length} سند کمتر از دو ردیف دارد.`
        : "همه اسناد حداقل دو ردیف حسابداری دارند.",
      affected: incomplete.length,
      samples: incomplete.map((r) => `${r.description} — ${ago(r.entry_date)}`),
      severityLabel: incomplete.length ? "بحرانی" : "سالم",
      action: incomplete.length ? { href: "/ledger", label: "بررسی اسناد" } : undefined,
      ranAt,
    },
    {
      id: "fifo-consistency",
      title: "سازگاری لایه FIFO",
      description: "بهای تمام‌شده با روش FIFO نگهداری می‌شود: مقدار بازشده هر بسته باید برابر مانده + مصرف‌شده باشد.",
      status: fifoBad.length ? "fail" : "pass",
      outcome: fifoBad.length
        ? `${fifoBad.length} بسته FIFO ناسازگار است.`
        : "بهای تمام‌شده FIFO برای همه دارایی‌ها سازگار است.",
      affected: fifoBad.length,
      samples: fifoBad.map((r) => `${r.symbol} — بسته ${ago(r.opened_at)}`),
      severityLabel: fifoBad.length ? "بحرانی" : "سالم",
      action: fifoBad.length ? { href: "/portfolio", label: "مشاهده بسته‌های FIFO" } : undefined,
      ranAt,
    },
    {
      id: "installment-linkage",
      title: "پیوند اقساط با دفترکل",
      description: "هر قسط پرداخت‌شده باید به سند دفترکل متناظر خود اشاره کند تا پرداخت‌ها ردیابی‌پذیر بمانند.",
      status: orphanLinks.length ? "warn" : "pass",
      outcome: orphanLinks.length
        ? `${orphanLinks.length} قسط «پرداخت‌شده» سند مرتبط ندارد.`
        : "همه اقساط پرداخت‌شده به سند دفترکل خود پیوند دارند.",
      affected: orphanLinks.length,
      samples: orphanLinks.map((r) => `${r.title} — قسط ${r.seq} (${ago(r.due_date)})`),
      severityLabel: orphanLinks.length ? "هشدار" : "سالم",
      action: orphanLinks.length ? { href: "/installments", label: "مشاهده اقساط" } : undefined,
      ranAt,
    },
    {
      id: "price-coverage",
      title: "پوشش قیمت‌گذاری",
      description: "ارزش روز دارایی‌ها فقط وقتی معتبر است که قیمت تازه داشته باشند؛ قیمت‌های قدیمی‌تر از ۳۰ روز علامت‌گذاری می‌شوند.",
      status: stalePrices.length ? "warn" : "pass",
      outcome: stalePrices.length
        ? `${stalePrices.length} دارایی قیمت تازه ندارد — ارزش‌گذاری آن‌ها ممکن است قدیمی باشد.`
        : "همه دارایی‌های در اختیار، قیمت تازه دارند.",
      affected: stalePrices.length,
      samples: stalePrices.map((r) => `${r.symbol} — آخرین قیمت: ${ago(r.last_price)}`),
      severityLabel: stalePrices.length ? "هشدار" : "سالم",
      action: stalePrices.length ? { href: "/market-data", label: "به‌روزرسانی قیمت‌ها" } : undefined,
      ranAt,
    },
    {
      id: "duplicate-records",
      title: "عدم وجود رکورد تکراری",
      description: "دو سند با تاریخ و شرح یکسان در یک سال اخیر معمولاً نشانه ثبت دوباره یک رویداد مالی است.",
      status: duplicates.length ? "warn" : "pass",
      outcome: duplicates.length
        ? `${duplicates.length} گروه رکورد مشابه پیدا شد که ارزش بازبینی دارند.`
        : "هیچ رکورد تکراری‌ای پیدا نشد.",
      affected: duplicates.length,
      samples: duplicates.map((r) => `${r.description} — ${ago(r.entry_date)} (×${r.c})`),
      severityLabel: duplicates.length ? "هشدار" : "سالم",
      action: duplicates.length ? { href: "/transactions", label: "بازبینی تراکنش‌ها" } : undefined,
      ranAt,
    },
    {
      id: "review-coverage",
      title: "بازبینی رکوردهای درون‌ریزی‌شده",
      description: "رکوردهای درون‌ریزی‌شده باید توسط انسان تأیید شوند تا اشتباهات نگاشت وارد دفترکل نشود.",
      status: unreviewed.length ? "warn" : "pass",
      outcome: unreviewed.length
        ? `${unreviewed.length} رکورد درون‌ریزی‌شده هنوز بازبینی نشده است.`
        : "همه رکوردهای درون‌ریزی‌شده تأیید شده‌اند.",
      affected: unreviewed.length,
      samples: unreviewed.map((r) => `${r.description} — ${ago(r.entry_date)}`),
      severityLabel: unreviewed.length ? "هشدار" : "سالم",
      action: unreviewed.length ? { href: "/transactions?review=unreviewed", label: "بازبینی کنید" } : undefined,
      ranAt,
    },
  ];
}

/** Short banner state for the top of the Audit page. */
export function summarize(checks: IntegrityCheck[]) {
  const get = (id: string) => checks.find((c) => c.id === id);
  return [
    { id: "ledger-balance", label: "تراز دفترکل", ok: get("ledger-balance")?.status === "pass" },
    { id: "record-completeness", label: "اسناد کامل", ok: get("record-completeness")?.status === "pass" },
    { id: "fifo-consistency", label: "بهای تمام‌شده سازگار", ok: get("fifo-consistency")?.status === "pass" },
    { id: "installment-linkage", label: "اقساط پیوند خورده", ok: get("installment-linkage")?.status === "pass" },
    { id: "price-coverage", label: "قیمت‌ها تازه", ok: get("price-coverage")?.status === "pass" },
    { id: "duplicate-records", label: "بدون رکورد تکراری", ok: get("duplicate-records")?.status === "pass" },
  ];
}
