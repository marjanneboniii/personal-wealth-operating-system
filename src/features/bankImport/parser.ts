import { D } from "@/domain/decimal";
import { formatJalaliIso, jalaliToIso, toLatinDigits } from "@/lib/format";

export type BankDraft = {
  inboxId?: string;
  suggestedAccountId?: string;
  accountMatchMessage?: string;
  sender?: string;
  receivedAt?: string;
  source: string;
  amountToman: string;
  date: string;
  direction: "withdrawal" | "deposit" | "unknown";
  description: string;
  warnings: string[];
};

export const MAX_IMPORT_CHARS = 100_000;
export const MAX_IMPORT_ROWS = 100;

export function normalizeBankText(text: string): string {
  return toLatinDigits(text).replace(/ي/g, "ی").replace(/ك/g, "ک")
    .replace(/[\u200c\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, " ")
    .replace(/\s+/g, " ").trim();
}

export function parseBankDate(text: string): string {
  const match = toLatinDigits(text).match(/\b((?:13|14|19|20)\d{2})[/-](\d{1,2})[/-](\d{1,2})\b/);
  if (!match) return "";
  const [, y, m, d] = match;
  const year = Number(y), month = Number(m), day = Number(d);
  if (month < 1 || month > 12 || day < 1 || day > 31) return "";
  try {
    if (year < 1700) {
      const iso = jalaliToIso(year, month, day);
      const expected = `${y}/${m.padStart(2, "0")}/${d.padStart(2, "0")}`;
      return formatJalaliIso(iso, "en") === expected ? iso : "";
    }
    const iso = `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
    return new Date(`${iso}T00:00:00Z`).toISOString().slice(0, 10) === iso ? iso : "";
  } catch { return ""; }
}

function money(value: string, unit: "rial" | "toman"): string {
  const canonical = toLatinDigits(value).replace(/[,٬\s]/g, "").replace(/٫/g, ".");
  if (!/^\d{1,18}(?:\.\d{1,2})?$/.test(canonical)) return "";
  const amount = D(canonical);
  if (!amount.gt(0)) return "";
  return unit === "rial" ? amount.div(10).toString() : amount.toString();
}

type Unit = "rial" | "toman";

/**
 * Labelled transaction amounts. «مانده قابل برداشت» is a balance, not a
 * withdrawal, so «برداشت» right after «قابل» is not an amount label.
 */
function amountCandidates(text: string): { amount: string; unit: Unit | null }[] {
  const expression = /(?:مبلغ|(?<!قابل\s)برداشت|واریز|خرید|پرداخت|دریافت)\s*(?:به\s*مبلغ\s*)?[:：\-]?\s*([0-9][0-9,٬]*(?:[٫.][0-9]{1,2})?)\s*(ریال|تومان)?/g;
  return [...text.matchAll(expression)].map((match) => ({
    amount: match[1],
    unit: match[2] === "ریال" ? "rial" : match[2] === "تومان" ? "toman" : null,
  }));
}

/** The one unit the whole message is written in, if it names exactly one. */
function messageUnit(text: string): Unit | null {
  const units = [...text.matchAll(/ریال|تومان/g)].map((m) => m[0]);
  return units.length && units.every((u) => u === units[0]) ? (units[0] === "ریال" ? "rial" : "toman") : null;
}

const plainDigits = (value: string) => toLatinDigits(value).replace(/[,٬\s]/g, "").replace(/٫/g, ".");

export type ReportedBalance = { value: string; unit: Unit | null };

/**
 * The balance a bank printed after the transaction («مانده: ۱۲٬۰۰۰٬۰۰۰»,
 * «موجودی حساب 5,000,000 ریال»). Conservative like the amount: two different
 * balances in one message, or none, mean no balance. «مانده قابل برداشت» is
 * deliberately not read — it can differ from the book balance by blocked funds.
 */
export function parseReportedBalance(source: string): ReportedBalance | null {
  const text = normalizeBankText(source);
  const expression = /(?:مانده|موجودی)(?:\s*(?:حساب|فعلی|جدید))?\s*[:：]?\s*(-?)\s*([0-9][0-9,٬]*(?:[٫.][0-9]{1,2})?)(-?)\s*(ریال|تومان)?/g;
  const found: ReportedBalance[] = [];
  for (const match of text.matchAll(expression)) {
    const digits = plainDigits(match[2]);
    if (!/^\d{1,18}(?:\.\d{1,2})?$/.test(digits)) continue;
    const negative = match[1] === "-" || match[3] === "-";
    found.push({ value: `${negative && D(digits).gt(0) ? "-" : ""}${D(digits).toString()}`, unit: match[4] === "ریال" ? "rial" : match[4] === "تومان" ? "toman" : null });
  }
  if (!found.length) return null;
  return new Set(found.map((f) => `${f.value}|${f.unit ?? ""}`)).size === 1 ? found[0] : null;
}

/**
 * The reported balance in Toman. Many bank messages print no unit at all; the
 * user has just confirmed the amount in Toman, so the message's own amount
 * figure says whether the bank wrote Rial (×10) or Toman. No decision → null,
 * never a guess that would raise a false tenfold difference.
 */
export function reportedBalanceToman(source: string, confirmedAmountToman: string): string | null {
  const balance = parseReportedBalance(source);
  if (!balance) return null;
  const text = normalizeBankText(source);
  let unit = balance.unit ?? messageUnit(text);
  if (!unit && D(confirmedAmountToman).gt(0)) {
    const printed = new Set(amountCandidates(text).map((c) => plainDigits(c.amount)).filter((v) => /^\d{1,18}(?:\.\d{1,2})?$/.test(v)).map((v) => D(v).toString()));
    const asToman = D(confirmedAmountToman).toString();
    const asRial = D(confirmedAmountToman).mul(10).toString();
    if (printed.size === 1 && printed.has(asRial)) unit = "rial";
    else if (printed.size === 1 && printed.has(asToman)) unit = "toman";
  }
  if (!unit) return null;
  return unit === "rial" ? D(balance.value).div(10).toString() : balance.value;
}

/** Conservative extraction: never mistake a balance or card number for the amount. */
export function parseBankMessage(source: string): BankDraft {
  if (source.length > 8000) throw new Error("هر پیام باید کمتر از ۸۰۰۰ نویسه باشد.");
  const text = normalizeBankText(source);
  const withdrawal = /برداشت|خرید|پرداخت/.test(text);
  const deposit = /واریز|دریافت/.test(text);
  const direction = withdrawal === deposit ? "unknown" : withdrawal ? "withdrawal" : "deposit";
  const warnings: string[] = [];
  const candidates = amountCandidates(text);
  const globalUnit = messageUnit(text);
  const amounts = candidates.map((c) => c.unit || globalUnit ? money(c.amount, c.unit ?? globalUnit!) : "");
  const unique = [...new Set(amounts.filter(Boolean))];
  const amountToman = unique.length === 1 && amounts.every(Boolean) ? unique[0] : "";
  if (!amountToman) warnings.push("مبلغ یا واحد پول روشن نیست؛ مبلغ تراکنش را به تومان وارد کنید.");
  if (direction === "unknown") warnings.push("جهت تراکنش روشن نیست؛ نوع آن را خودتان انتخاب کنید.");
  if (/رمز|کد\s*(?:تأیید|تایید|فعال)|یکبار\s*مصرف/.test(text)) {
    warnings.push("این متن ممکن است پیام رمز یا تأیید باشد؛ پیش از ثبت بررسی کنید.");
  }
  if (/قسط|اقساط|وام|تسهیلات|انتقال|کارت\s*به\s*کارت|رمزارز|سهام|صندوق|طلا/.test(text)) {
    warnings.push("این جابه‌جایی ممکن است انتقال، بدهی یا خرید دارایی باشد و الزاماً درآمد یا هزینه نیست.");
  }
  const date = parseBankDate(text);
  if (!date) warnings.push("تاریخ معتبر پیدا نشد؛ تاریخ واقعی تراکنش را انتخاب کنید.");
  return { source, amountToman, date, direction, description: "", warnings };
}

/** Quoted CSV parser; no formulas, macros, URLs or embedded code are evaluated. */
function csvCells(text: string): string[][] {
  const first = text.split(/\r?\n/, 1)[0];
  const delimiter = first.includes(";") && !first.includes(",") ? ";" : ",";
  const rows: string[][] = [];
  let row: string[] = [], cell = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') {
      if (quoted && text[i + 1] === '"') { cell += '"'; i++; }
      else if (quoted || !cell) quoted = !quoted;
      else throw new Error("ساختار نقل‌قول CSV معتبر نیست.");
    } else if (ch === delimiter && !quoted) { row.push(cell); cell = ""; }
    else if ((ch === "\n" || ch === "\r") && !quoted) {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      if (row.some((c) => c.trim())) rows.push(row);
      if (rows.length > MAX_IMPORT_ROWS + 1) throw new Error("در هر نوبت حداکثر ۱۰۰ ردیف وارد کنید.");
      row = []; cell = "";
    } else cell += ch;
  }
  if (quoted) throw new Error("نقل‌قول CSV بسته نشده است.");
  row.push(cell);
  if (row.some((c) => c.trim())) rows.push(row);
  return rows;
}

export function parseBankCsv(text: string): BankDraft[] {
  if (text.length > MAX_IMPORT_CHARS) throw new Error("فایل بیش از حد بزرگ است.");
  const rows = csvCells(text.replace(/^\uFEFF/, ""));
  if (rows.length < 2 || rows.length > MAX_IMPORT_ROWS + 1) throw new Error("CSV باید سرستون و ۱ تا ۱۰۰ ردیف داشته باشد.");
  const headers = rows[0].map(normalizeBankText);
  const find = (names: string[]) => headers.findIndex((h) => names.includes(h.toLowerCase()));
  const dateIndex = find(["تاریخ", "date"]);
  const amountIndex = find(["مبلغ", "amount", "مبلغ (تومان)", "مبلغ (ریال)"]);
  const directionIndex = find(["نوع", "type", "جهت", "direction"]);
  const unitIndex = find(["واحد", "unit", "واحد پول"]);
  const descriptionIndex = find(["شرح", "description", "توضیحات"]);
  if (dateIndex < 0 || amountIndex < 0 || directionIndex < 0) throw new Error("ستون‌های تاریخ، مبلغ و نوع لازم هستند.");
  return rows.slice(1).map((cells) => {
    if (cells.length !== headers.length) throw new Error("تعداد ستون‌های یکی از ردیف‌ها با سرستون برابر نیست.");
    const type = normalizeBankText(cells[directionIndex]).toLowerCase();
    const direction = ["برداشت", "withdrawal", "debit"].includes(type) ? "withdrawal" : ["واریز", "deposit", "credit"].includes(type) ? "deposit" : "unknown";
    const unit = unitIndex >= 0 ? normalizeBankText(cells[unitIndex]).toLowerCase() : headers[amountIndex].includes("تومان") ? "تومان" : headers[amountIndex].includes("ریال") ? "ریال" : "";
    const amountToman = ["تومان", "toman", "irt"].includes(unit) ? money(cells[amountIndex], "toman") : ["ریال", "rial", "irr"].includes(unit) ? money(cells[amountIndex], "rial") : "";
    const date = parseBankDate(cells[dateIndex]);
    const description = descriptionIndex >= 0 ? cells[descriptionIndex].trim().slice(0, 200) : "";
    // Canonical values make re-imports independent of quoting and header order.
    const source = JSON.stringify([cells[dateIndex].trim(), cells[amountIndex].trim(), type, unit, description]);
    const warnings = parseBankMessage(description).warnings.filter((w) => /ممکن است/.test(w));
    if (!amountToman) warnings.push("واحد یا مبلغ معتبر نیست؛ مبلغ را به تومان بررسی کنید.");
    if (!date) warnings.push("تاریخ معتبر نیست؛ تاریخ واقعی را انتخاب کنید.");
    if (direction === "unknown") warnings.push("نوع ردیف روشن نیست؛ نوع تراکنش را انتخاب کنید.");
    return { source, amountToman, date, direction, description, warnings };
  });
}
