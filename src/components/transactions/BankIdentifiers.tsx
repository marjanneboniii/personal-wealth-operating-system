"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { addBankIdentifierAction, removeBankIdentifierAction } from "@/app/actions/bankIdentifiers";
import Link from "next/link";
import Icon from "@/components/ui/Icon";
import SmsChoices from "./SmsChoices";

type Props = { accounts: { id: string; name: string }[]; identifiers: { id: string; accountName: string; bankName: string; kind: string; suffix: string }[] };

const KIND_LABEL: Record<string, string> = { card: "کارت", account: "حساب", iban: "شبا" };

/** Step 1 — which bank account each SMS belongs to, by the last digits it prints. */
export default function BankIdentifiers({ accounts, identifiers }: Props) {
 const router = useRouter();
 const [message, setMessage] = useState("");
 const [pending, setPending] = useState(false);
 const [accountId, setAccountId] = useState(accounts.length === 1 ? accounts[0].id : "");
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

 const form = <form onSubmit={submit}><fieldset disabled={pending} className="space-y-4">
  <input type="hidden" name="accountId" value={accountId} /><input type="hidden" name="kind" value={kind} />
  <div className="space-y-1">
   <SmsChoices label="حساب بانکی در توازن" value={accountId} options={accounts} onChange={setAccountId} />
   <p className="muted text-[length:var(--fs-xs)]">فقط حساب‌های بانکی تومانی. تومانِ صرافی‌ها، صندوق نقد و حساب‌های تتر پیامک بانکی ندارند.</p>
  </div>
  <label className="block"><span className="label">نام بانک، همان‌طور که در پیامک آمده</span><input name="bankName" className="field" required maxLength={60} placeholder="مثلاً ملت" /></label>
  <SmsChoices label="پیامک چه شماره‌ای را نشان می‌دهد؟" value={kind} options={[{ id: "card", name: "کارت" }, { id: "account", name: "حساب" }, { id: "iban", name: "شبا" }]} onChange={setKind} />
  <label className="block"><span className="label">چند رقم آخرِ همان شماره</span><input name="suffix" className="field num" dir="ltr" required inputMode="numeric" minLength={4} maxLength={8} placeholder="1234" /><span className="muted mt-1 block text-[length:var(--fs-xs)]">۴ تا ۸ رقم کافی است. شمارهٔ کامل، رمز و CVV2 لازم نیست.</span></label>
  <button className="btn btn-primary w-full" type="submit" disabled={!accountId}>وصل کن</button>
 </fieldset></form>;

 return <section id="sms-cards" className="card expense-card scroll-mt-20">
  <header className="expense-head"><h2 className="sms-step-title"><span className="sms-step-number" aria-hidden="true">۱</span>کارت‌ها و حساب‌های بانکی</h2><span className="expense-sub">{identifiers.length ? "وصل شد" : "قدم اول"}</span></header>
  <p className="text-sm leading-7">هر پیامک بانک چند رقم آخر کارت یا حساب را دارد. آن را یک بار به حساب بانکی‌اش در توازن وصل کنید تا پیام‌ها خودشان حساب درست را پیدا کنند.</p>
  {identifiers.length > 0 && <ul className="sms-connected-list">{identifiers.map((i) => <li key={i.id} className="sms-connected-item">
   <span className="flex min-w-0 items-center gap-2"><span className="sms-ok" aria-hidden="true"><Icon name="check" size={12} strokeWidth={3} /></span><span>{i.bankName} · {KIND_LABEL[i.kind] ?? "حساب"} <bdi dir="ltr">…{i.suffix}</bdi> ← {i.accountName}</span></span>
   <button type="button" disabled={pending} className="btn btn-ghost !min-h-9 !px-3 !py-1.5 text-[length:var(--fs-xs)]" onClick={() => void remove(i.id)}>حذف</button>
  </li>)}</ul>}
  {!accounts.length ? <p className="expense-note">حساب بانکی تومانی ندارید. <Link href="/accounts" className="underline">اول یک حساب بانکی بسازید</Link>؛ بعد به اینجا برگردید.</p>
   : identifiers.length ? <details className="sms-guide"><summary>افزودن کارت یا حساب دیگر</summary><div className="mt-4">{form}</div></details> : form}
  {message && <p className="mt-1 text-sm" role="status">{message}</p>}
 </section>;
}
