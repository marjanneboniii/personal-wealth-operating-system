"use client";

import Link from "next/link";
import SmsChoices from "./SmsChoices";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { rejectBankSmsAction } from "@/app/actions/bankSms";
import { confirmBankImportAction, type BankImportResult } from "@/app/actions/bankImport";
import { MAX_IMPORT_CHARS, MAX_IMPORT_ROWS, normalizeBankText, parseBankCsv, parseBankMessage, type BankDraft } from "@/features/bankImport/parser";
import { suggestBankCategory, type ConfirmedBankRow, type summarizeBankHabits } from "@/features/bankImport/insights";
import { formatJalaliIso, formatMoney } from "@/lib/format";
import AmountInput from "@/components/ui/AmountInput";
import DualDateInput from "@/components/ui/DualDateInput";
import { Card } from "@/components/ui/Card";

type CategoryGroup = { id: string; name: string; children: { id: string; name: string }[] };
type Props = {
  smsDrafts: BankDraft[];
  accounts: { id: string; name: string }[];
  expenseCategories: CategoryGroup[];
  incomeCategories: CategoryGroup[];
  history: ConfirmedBankRow[];
  habits: ReturnType<typeof summarizeBankHabits>;
  historyLimited: boolean;
  rate: string;
  rateDate: string;
};

function ReviewRow({ draft, props, onPendingChange }: { draft: BankDraft; props: Props; onPendingChange: (pending: boolean) => void }) {
  const router = useRouter();
  const [type, setType] = useState("");
  const [accountId, setAccountId] = useState(draft.suggestedAccountId ?? "");
  const [destinationId, setDestinationId] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [amount, setAmount] = useState(draft.amountToman);
  const [date, setDate] = useState(draft.date);
  const [description, setDescription] = useState(draft.description);
  const [openingConfirmed, setOpeningConfirmed] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [rateConfirmed, setRateConfirmed] = useState(false);
  const [acknowledgedRate, setAcknowledgedRate] = useState("");
  const [allowSimilar, setAllowSimilar] = useState(false);
  const [rejected, setRejected] = useState(false);
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<BankImportResult | null>(null);
  const posting = useRef(false);
  const transferLink = useRef<string | null>(null);
  const groups = type === "income" ? props.incomeCategories : props.expenseCategories;
  const suggestedId = suggestBankCategory(description, type, props.history);
  const suggestion = groups.flatMap((g) => g.children).find((c) => c.id === suggestedId);
  const ready = ["expense", "income", "transfer"].includes(type) && !!accountId && /^\d{1,18}$/.test(amount) && BigInt(amount || "0") > 0n && !!date && description.trim().length >= 2 && confirmed && (!draft.inboxId || openingConfirmed) && rateConfirmed && acknowledgedRate === props.rate && (type === "transfer" ? !!destinationId && destinationId !== accountId : !!categoryId);

  async function reject() {
    if (!draft.inboxId) { setRejected(true); return; }
    if (posting.current) return;
    posting.current = true; setPending(true); onPendingChange(true);
    try { const response = await rejectBankSmsAction(draft.inboxId); if (response.ok) { setRejected(true); router.refresh(); } else setResult(response); }
    catch { setResult({ ok: false, message: "رد پیام انجام نشد؛ دوباره تلاش کنید." }); }
    finally { posting.current = false; setPending(false); onPendingChange(false); }
  }
  function changed() { setOpeningConfirmed(false); setConfirmed(false); setAllowSimilar(false); setResult(null); }
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!ready || posting.current) return;
    posting.current = true; setPending(true); onPendingChange(true);
    try {
      const fd = new FormData();
      Object.entries({ source: draft.source, type, accountId, destinationId, categoryId, amountToman: amount, date, description, confirmed: "yes", rateConfirmed: "yes", expectedRate: props.rate, ...(draft.inboxId ? { inboxId: draft.inboxId, openingConfirmed: openingConfirmed ? "yes" : "no" } : {}), allowSimilar: allowSimilar ? "yes" : "no" }).forEach(([k, v]) => fd.set(k, v));
      if (transferLink.current) fd.set("existingTransferId", transferLink.current);
      transferLink.current = null;
      const response = await confirmBankImportAction(fd);
      setResult(response);
      if (response.ok) router.refresh();
    } catch { setResult({ ok: false, message: "پاسخ ثبت دریافت نشد؛ دوباره تلاش کنید. ثبت تکراری این مورد کنترل می‌شود." }); }
    finally { posting.current = false; setPending(false); onPendingChange(false); }
  }

  if (result?.ok) return <Card><p role="status">{result.message}</p>{result.entryId && <Link className="btn btn-ghost mt-3" href={`/financial-records?entry=${result.entryId}`}>مشاهده سند مالی</Link>}</Card>;
  if (rejected) return <Card><p>این مورد رد شد؛ اثری بر حساب‌ها ندارد.</p><button type="button" className="btn btn-ghost mt-3" onClick={() => setRejected(false)}>برگرداندن به بازبینی</button></Card>;

  return (
    <Card className="sms-review-card" title={draft.direction === "withdrawal" ? "برداشت بانکی — نیاز به تعیین نوع" : draft.direction === "deposit" ? "واریز بانکی — نیاز به تعیین نوع" : "پیام بانکی — نیاز به بررسی"}>
      {draft.sender && <p className="mb-2 text-sm">فرستنده اعلام‌شده: {draft.sender}</p>}
      <details className="mb-3"><summary className="cursor-pointer text-sm">متن ورودی</summary><p className="mt-2 whitespace-pre-wrap break-words text-sm" dir="auto">{draft.source}</p></details>
      {draft.warnings.length > 0 && <ul className="mb-4 space-y-1 text-sm" style={{ color: "var(--warning)" }}>{draft.warnings.map((w) => <li key={w}>{w}</li>)}</ul>}
      {draft.accountMatchMessage && <p className="mb-3 text-sm">{draft.accountMatchMessage}</p>}
      <form onSubmit={submit} className="space-y-4">
        <fieldset disabled={pending} className="space-y-4">
          <SmsChoices label="این جابه‌جایی چه نوعی است؟" value={type} options={[{ id: "expense", name: "هزینه" }, { id: "income", name: "درآمد" }, { id: "transfer", name: "انتقال خودم" }, { id: "debt_repayment", name: "قسط / بدهی" }, { id: "buy", name: "خرید دارایی" }, { id: "sell", name: "فروش دارایی" }, { id: "debt", name: "وام / طلب" }]} onChange={(id) => { setType(id); setCategoryId(""); changed(); }} />
          {["buy", "sell", "debt_repayment", "debt"].includes(type) ? <p className="text-sm">این مورد باید به دارایی یا تعهد موجود متصل شود. <Link className="underline" href={type === "debt" ? "/debts" : `/new?${new URLSearchParams({ type, irtAmount: amount, entryDate: date, title: description })}`}>ادامه در بخش مربوط</Link>؛ پس از ثبت، این مورد را از صف رد کنید.</p> : <>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="sm:col-span-2"><SmsChoices label={type === "income" ? "واریز به کدام حساب؟" : "پرداخت از کدام حساب؟"} value={accountId} options={props.accounts} onChange={(id) => { setAccountId(id); changed(); }} /></div>
              {type === "transfer" ? <div className="sm:col-span-2"><SmsChoices label="حساب مقصد" value={destinationId} options={props.accounts.filter((a) => a.id !== accountId)} onChange={(id) => { setDestinationId(id); changed(); }} /></div> : <div className="sm:col-span-2 space-y-2"><p className="label">{type === "income" ? "منبع درآمد" : "دستهٔ هزینه"}</p>{categoryId && <p className="expense-note">انتخاب شما: {groups.flatMap((g) => g.children).find((c) => c.id === categoryId)?.name}</p>}{groups.map((g) => <details key={g.id} className="sms-guide"><summary>{g.name}</summary><div className="pt-3"><SmsChoices label={`انتخاب از ${g.name}`} value={categoryId} options={g.children} onChange={(id) => { setCategoryId(id); changed(); }} /></div></details>)}</div>}
              <label className="block"><span className="label">مبلغ تراکنش به تومان</span><AmountInput className="field" value={amount} inputMode="decimal" maxDecimals={1} onValueChange={(v) => { setAmount(v); changed(); }} unit="toman" required /></label>
              <DualDateInput name="date" value={date} onChange={(v) => { setDate(v); changed(); }} required />
            </div>
            {amount.includes(".") && <p className="text-sm">مبلغ ریالی به تومان اعشاری تبدیل شده است؛ برای ثبت در این فرم مبلغ صحیح تومان را بررسی کنید.</p>}
            <label className="block"><span className="label">شرح کوتاه تراکنش</span><input className="field" value={description} maxLength={200} minLength={2} required onChange={(e) => { setDescription(e.target.value); changed(); }} placeholder="مثلاً خرید مواد غذایی؛ اطلاعات کارت و رمز را ننویسید" /></label>
            {suggestion && type !== "transfer" && <button type="button" className="btn btn-ghost" onClick={() => { setCategoryId(suggestion.id); changed(); }}>پیشنهاد بر اساس شرح مشابه قبلی: {suggestion.name}</button>}
            <p className="text-sm">{type === "transfer" ? "این مورد یک انتقال ثبت می‌کند و هزینه یا درآمد نیست. حساب مبدأ همیشه حساب برداشت و مقصد حساب واریز است؛ اگر پیام دوم همین انتقال رسید، پس از بررسی سند آن را رد کنید. دو پیام را جداگانه ثبت نکنید." : type === "income" ? "مبلغ به حساب دریافت اضافه و به منبع درآمد انتخاب‌شده نسبت داده می‌شود." : "مبلغ از حساب پرداخت کم و در دستهٔ هزینهٔ انتخاب‌شده ثبت می‌شود."}</p>
            <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={rateConfirmed && acknowledgedRate === props.rate} onChange={(e) => { setRateConfirmed(e.target.checked); setAcknowledgedRate(props.rate); }} /> <span>معادل دلاری با نرخ فعلی من هنگام ثبت فریز می‌شود: {formatMoney(props.rate, "IRT")} برای هر دلار (تاریخ نرخ: {formatJalaliIso(props.rateDate)}). این نرخ لزوماً نرخ روز پیام نیست؛ این موضوع را بررسی کردم.</span></label>
            {draft.inboxId && <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={openingConfirmed} onChange={(e) => setOpeningConfirmed(e.target.checked)} /><span>این تراکنش پس از زمان مبنای موجودی افتتاحیه حساب رخ داده و مبلغ آن در افتتاحیه منظور نشده است.</span></label>}
            <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} /> <span>نوع، حساب، مبلغ، تاریخ و دسته را بررسی کردم؛ این جابه‌جایی قبلاً ثبت نشده و نوع انتخاب‌شده با واقعیت آن مطابقت دارد.</span></label>
            {result?.duplicate && <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={allowSimilar} onChange={(e) => setAllowSimilar(e.target.checked)} /><span>تراکنش مشابه را بررسی کردم؛ این یک جابه‌جایی مستقل و واقعی است.</span></label>}
            {result && <div role="alert" className="text-sm" style={{ color: "var(--warning)" }}><p>{result.message} {result.duplicate && <Link className="underline" href={`/transactions?${new URLSearchParams({ account: accountId, range: "all" })}`}>بررسی سوابق حساب</Link>}</p>{result.message.includes("نرخ") && <button type="button" className="btn btn-ghost mt-2" onClick={() => router.refresh()}>تازه‌سازی نرخ و سوابق، با حفظ صف</button>}</div>}
            {result?.transferEntryId && <Link className="btn btn-ghost" href={`/financial-records?entry=${result.transferEntryId}`}>بررسی سند انتقال قبلی</Link>}
            {result?.transferEntryId && <button type="button" className="btn btn-ghost" disabled={!ready || pending} onClick={(event) => { transferLink.current = result.transferEntryId!; event.currentTarget.form?.requestSubmit(); }}>تأیید می‌کنم این پیام مربوط به همین انتقال است؛ اتصال به سند قبلی</button>}
            <button type="submit" className="btn btn-primary" disabled={!ready || pending}>{pending ? "در حال ثبت…" : "تأیید نهایی و ثبت"}</button>
          </>}
          <button type="button" className="btn btn-ghost ms-2" onClick={reject}>رد این مورد</button>
        </fieldset>
      </form>
    </Card>
  );
}

export default function BankImportWorkspace(props: Props) {
  const [text, setText] = useState("");
  const [drafts, setDrafts] = useState<BankDraft[]>([]);
  const [error, setError] = useState("");
  const [filePending, setFilePending] = useState(false);
  const [batch, setBatch] = useState(0);
  const [busyRows, setBusyRows] = useState(0);
  function add(rows: BankDraft[]) {
    const seen = new Set(drafts.map((d) => normalizeBankText(d.source)));
    const fresh = rows.filter((r) => { const key = normalizeBankText(r.source); if (seen.has(key)) return false; seen.add(key); return true; });
    if (drafts.length + fresh.length > MAX_IMPORT_ROWS) throw new Error("در صف فعلی حداکثر ۱۰۰ مورد نگه دارید.");
    setDrafts([...drafts, ...fresh]);
    setError(fresh.length < rows.length ? "موارد با متن کاملاً یکسان در صف تکرار نشدند. جابه‌جایی‌های مستقل با متن یکسان را از فرم ثبت دستی وارد کنید." : "");
  }
  async function readCsv(file: File | undefined) {
    if (!file) return;
    setFilePending(true); setError("");
    try {
      if (!file.name.toLowerCase().endsWith(".csv") || file.size > 400_000) throw new Error("یک فایل CSV متنی کمتر از ۴۰۰ کیلوبایت انتخاب کنید.");
      add(parseBankCsv(await file.text()));
    } catch (e) { setError(e instanceof Error ? e.message : "خواندن فایل ممکن نشد."); }
    finally { setFilePending(false); }
  }
  return (
    <div className="space-y-5">
      <Card title="صندوق پیامک‌های دریافتی"><p className="text-sm">{props.smsDrafts.length ? `${props.smsDrafts.length.toLocaleString("fa-IR")} پیام منتظر بازبینی است. فقط پس از تأیید ثبت مالی می‌شود.` : "پیام جدیدی برای بازبینی نیست؛ پس از اتصال Shortcuts، پیام‌های تراکنش در این بخش ظاهر می‌شوند."}</p></Card>
      {props.smsDrafts.map((d) => <ReviewRow key={d.inboxId} draft={d} props={props} onPendingChange={(pending) => setBusyRows((n) => n + (pending ? 1 : -1))} />)}
      <details className="sms-guide"><summary>روش جایگزین: پیام یا صورت‌حساب دستی</summary>
      <Card className="mt-3" title="ورود دستی">
        <p className="mb-3 text-sm">متن در همین صفحه پردازش می‌شود. صف موقت است و با خروج یا بارگذاری مجدد صفحه از بین می‌رود؛ فقط موارد تأییدشده ذخیره می‌شوند. پیام‌های اتصال Shortcuts در صندوق بالا به‌صورت دائمی نگهداری می‌شوند؛ این بخش فقط روش ورود دستی جایگزین است.</p>
        {!props.accounts.length && <p className="mb-3 text-sm"><Link className="underline" href="/accounts">ابتدا یک حساب پول تومانی ثبت کنید.</Link></p>}
        <label className="block"><span className="label">متن یک پیام بانکی</span><textarea className="field min-h-28" value={text} maxLength={8000} onChange={(e) => setText(e.target.value)} placeholder="بانک ملت — برداشت: ۲٬۵۰۰٬۰۰۰ ریال — ۱۴۰۵/۰۶/۲۶" /></label>
        <button type="button" className="btn btn-primary mt-3" disabled={!text.trim() || filePending} onClick={() => { try { add([parseBankMessage(text)]); setText(""); } catch (e) { setError(e instanceof Error ? e.message : "پیام معتبر نیست."); } }}>ساخت پیشنهاد برای بازبینی</button>
        <label className="mt-4 block"><span className="label">صورت‌حساب CSV با متن UTF-8</span><input type="file" accept=".csv,text/csv" disabled={filePending} onChange={(e) => { void readCsv(e.target.files?.[0]); e.target.value = ""; }} /></label>
        <p className="mt-2 text-sm">ستون‌ها: تاریخ، مبلغ، نوع، واحد، شرح. نوع: برداشت یا واریز؛ واحد: ریال یا تومان. مبلغ دارای جداکننده را داخل نقل‌قول قرار دهید. تا {MAX_IMPORT_ROWS} ردیف و {MAX_IMPORT_CHARS.toLocaleString("fa-IR")} نویسه؛ برای Excel ابتدا خروجی CSV بگیرید.</p>
        <details className="mt-2 text-sm"><summary className="cursor-pointer">نمونهٔ ساختار CSV</summary><pre className="mt-2 overflow-x-auto whitespace-pre" dir="rtl">{'تاریخ,مبلغ,نوع,واحد,شرح\n۱۴۰۵/۰۶/۲۶,۲۵۰۰۰۰,برداشت,تومان,خرید مواد غذایی'}</pre></details>
        {error && <p role="alert" className="mt-3 text-sm">{error}</p>}
        {filePending && <p role="status">در حال خواندن فایل…</p>}
      </Card>
      </details>
      {drafts.length > 0 && <>
        <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="font-semibold">صف بازبینی — {drafts.length.toLocaleString("fa-IR")} مورد</h2><button type="button" className="btn btn-ghost" disabled={busyRows > 0 || filePending} onClick={() => { if (window.confirm("صف موقت پاک شود؟ تراکنش‌های ثبت‌شده باقی می‌مانند.")) { setDrafts([]); setBatch(batch + 1); } }}>پاک‌کردن صف موقت</button></div>
        {drafts.map((d, i) => <ReviewRow key={`${batch}-${i}`} draft={d} props={props} onPendingChange={(pending) => setBusyRows((n) => n + (pending ? 1 : -1))} />)}
      </>}
      <Card title="الگوی درآمد و هزینهٔ این ماه شمسی تا امروز">
        <p className="mb-3 text-sm">فقط تراکنش‌های ثبت‌شده و بازبینی‌شده؛ انتقال، بازپرداخت اصل بدهی و هزینهٔ غیرنقدی در این اعداد نیستند. مبالغ تومانی از نرخ فریز‌شدهٔ هر سند خوانده می‌شوند.</p>
        {props.habits.count ? <dl className="grid gap-4 sm:grid-cols-2"><div><dt className="text-sm">درآمد ثبت‌شده</dt><dd>{formatMoney(props.habits.income, "IRT")}</dd></div><div><dt className="text-sm">هزینهٔ ثبت‌شده</dt><dd>{formatMoney(props.habits.spending, "IRT")}</dd></div><div><dt className="text-sm">مازاد / کسری درآمد نسبت به هزینه</dt><dd>{formatMoney(props.habits.net, "IRT")}</dd></div><div><dt className="text-sm">خرج معمول در روزهای دارای هزینه (میانه)</dt><dd>{props.habits.typicalSpendingDay ? formatMoney(props.habits.typicalSpendingDay, "IRT") : "دادهٔ هزینه موجود نیست"}</dd></div><div><dt className="text-sm">هزینه‌های تا ۱۰۰ هزار تومان</dt><dd>{props.habits.smallExpenseCount.toLocaleString("fa-IR")} تراکنش</dd></div></dl> : <p>برای تحلیل، تراکنش تأییدشده با مبلغ تومانی فریز‌شده لازم است.</p>}
        {props.habits.missing > 0 && <p className="mt-3 text-sm">{props.habits.missing.toLocaleString("fa-IR")} تراکنش مبلغ تومانی فریز‌شده ندارد و از محاسبات کنار گذاشته شده؛ اعداد این ماه کامل نیستند.</p>}
        {props.historyLimited && <p className="mt-3 text-sm">تحلیل و پیشنهاد دسته بر اساس آخرین ۵۰۰ تراکنش بازبینی‌شده است؛ ممکن است بخشی از داده‌های ماه در این مجموعه نباشد.</p>}
        <Link className="btn btn-ghost mt-4" href="/insights">بینش‌های مالی بیشتر</Link>
      </Card>
    </div>
  );
}
