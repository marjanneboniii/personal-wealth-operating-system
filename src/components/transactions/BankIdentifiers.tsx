"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { addBankIdentifierAction, removeBankIdentifierAction } from "@/app/actions/bankIdentifiers";
import { Card } from "@/components/ui/Card";

type Props = { accounts: { id: string; name: string }[]; identifiers: { id: string; accountName: string; bankName: string; kind: string; suffix: string }[] };
export default function BankIdentifiers({ accounts, identifiers }: Props) {
 const router = useRouter();
 const [message, setMessage] = useState("");
 const [pending, setPending] = useState(false);
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
 return <Card title="۱. بانک و کارت‌های خودم را معرفی می‌کنم">
  <p className="mb-3 text-sm">پس از راه‌اندازی اولیه، هر کارت یا شماره حساب را به حساب موجود خودتان وصل کنید. چند کارت یک حساب را به همان حساب وصل کنید؛ دوباره موجودی افتتاحیه وارد نکنید. فقط ۴ تا ۸ رقم پایانی لازم است؛ شماره کامل کارت، رمز و CVV2 را وارد نکنید.</p>
  <form onSubmit={submit}><fieldset disabled={pending} className="grid gap-3 sm:grid-cols-2">
   <label><span className="label">حساب من در توازن</span><select name="accountId" className="field" required defaultValue=""><option value="">انتخاب حساب تومانی</option>{accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
   <label><span className="label">نام بانک در متن پیامک</span><input name="bankName" className="field" required maxLength={60} placeholder="مثلاً ملت یا ملی ایران" /></label>
   <label><span className="label">شناسه‌ای که در پیامک نوشته می‌شود</span><select name="kind" className="field"><option value="card">کارت</option><option value="account">حساب</option><option value="iban">شبا</option></select></label>
   <label><span className="label">۴ تا ۸ رقم پایانی</span><input name="suffix" className="field" required inputMode="numeric" minLength={4} maxLength={8} placeholder="۱۲۳۴" /></label>
   <button className="btn btn-primary" type="submit">وصل کردن شناسه به حساب</button>
  </fieldset></form>
  <p className="my-3 text-sm">برای هر بانک تکرار کنید. نام بانک و شناسه باید در متن پیام باشند؛ نام فرستنده به‌تنهایی کافی نیست. اگر دو حساب با شناسه مشابه دارید، رقم‌های بیشتری وارد کنید یا حساب را هنگام بازبینی انتخاب کنید.</p>
  <ul className="space-y-2">{identifiers.map((i) => <li key={i.id} className="flex flex-wrap items-center gap-2 text-sm"><span>بانک {i.bankName} · {i.kind === "card" ? "کارت" : i.kind === "iban" ? "شبا" : "حساب"} …{i.suffix} ← {i.accountName}</span><button type="button" disabled={pending} className="btn btn-ghost" onClick={() => void remove(i.id)}>حذف اتصال شناسه</button></li>)}</ul>
  {message && <p className="mt-3 text-sm" role="status">{message}</p>}
 </Card>;
}
