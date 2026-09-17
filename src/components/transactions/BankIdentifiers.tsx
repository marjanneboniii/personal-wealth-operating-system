"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { addBankIdentifierAction, removeBankIdentifierAction } from "@/app/actions/bankIdentifiers";
import Link from "next/link";
import SmsChoices from "./SmsChoices";

type Props = { accounts: { id: string; name: string }[]; identifiers: { id: string; accountName: string; bankName: string; kind: string; suffix: string }[] };
export default function BankIdentifiers({ accounts, identifiers }: Props) {
 const router = useRouter();
 const [message, setMessage] = useState("");
 const [pending, setPending] = useState(false);
 const [accountId, setAccountId] = useState("");
 const [kind, setKind] = useState("card");
 async function submit(event: React.FormEvent<HTMLFormElement>) {
  event.preventDefault(); if (pending) return;
  const form = event.currentTarget;
  const fd = new FormData(form);
  setPending(true);
  try {
   const result = await addBankIdentifierAction(Object.fromEntries(fd));
   setMessage(result.message);
   if (result.ok) { form.reset(); router.refresh(); }
  } catch { setMessage("پاسخ دریافت نشد؛ دوباره تلاش کنید."); }
  finally { setPending(false); }
 }
 async function remove(id: string) {
  if (pending) return; setPending(true);
  try { const result = await removeBankIdentifierAction(id); setMessage(result.message); if (result.ok) router.refresh(); }
  catch { setMessage("حذف انجام نشد."); }
  finally { setPending(false); }
 }
 return <section className="card expense-card">
  <header className="expense-head"><h2>بانک و کارت‌های من</h2><span className="expense-sub">قدم اول</span></header>
  <p className="mb-3 text-sm">پس از راه‌اندازی اولیه، هر کارت یا شماره حساب را به حساب موجود خودتان وصل کنید. چند کارت یک حساب را به همان حساب وصل کنید؛ دوباره موجودی افتتاحیه وارد نکنید. فقط ۴ تا ۸ رقم پایانی لازم است؛ شماره کامل کارت، رمز و CVV2 را وارد نکنید.</p>
  {!accounts.length && <p className="expense-note"><Link href="/accounts" className="underline">ابتدا یک حساب تومانی معرفی کنید.</Link></p>}
  <form onSubmit={submit}><fieldset disabled={pending} className="space-y-4">
   <input type="hidden" name="accountId" value={accountId} /><input type="hidden" name="kind" value={kind} />
   <SmsChoices label="این کارت به کدام حساب وصل است؟" value={accountId} options={accounts} onChange={setAccountId} />
   <label><span className="label">نام بانک در متن پیامک</span><input name="bankName" className="field" required maxLength={60} placeholder="مثلاً ملت یا ملی ایران" /></label>
   <SmsChoices label="در پیامک چه شناسه‌ای نوشته می‌شود؟" value={kind} options={[{ id: "card", name: "کارت" }, { id: "account", name: "حساب" }, { id: "iban", name: "شبا" }]} onChange={setKind} />
   <label><span className="label">۴ تا ۸ رقم پایانی</span><input name="suffix" className="field" required inputMode="numeric" minLength={4} maxLength={8} placeholder="۱۲۳۴" /></label>
   <button className="btn btn-primary w-full" type="submit" disabled={!accountId}>وصل کردن شناسه به حساب</button>
  </fieldset></form>
  <p className="expense-note">برای هر بانک تکرار کنید. نام بانک و شناسه باید در متن پیام باشند؛ نام فرستنده به‌تنهایی کافی نیست. اگر دو حساب با شناسه مشابه دارید، رقم‌های بیشتری وارد کنید یا حساب را هنگام بازبینی انتخاب کنید.</p>
  <ul className="sms-connected-list">{identifiers.map((i) => <li key={i.id} className="sms-connected-item"><span>بانک {i.bankName} · {i.kind === "card" ? "کارت" : i.kind === "iban" ? "شبا" : "حساب"} …{i.suffix} ← {i.accountName}</span><button type="button" disabled={pending} className="btn btn-ghost" onClick={() => void remove(i.id)}>حذف اتصال شناسه</button></li>)}</ul>
  {message && <p className="mt-3 text-sm" role="status">{message}</p>}
 </section>;
}
