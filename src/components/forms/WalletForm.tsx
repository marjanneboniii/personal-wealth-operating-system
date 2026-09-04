"use client";

import { useState, useTransition } from "react";
import { createWalletAction } from "@/app/actions";
import { BankLogo } from "@/components/ui/IranLogo";

const kinds = [
  ["bank", "حساب بانکی"], ["cash", "نقد"], ["exchange", "صرافی"],
  ["hot", "کیف پول"], ["cold", "کیف پول سرد"], ["fund", "صندوق / کارگزاری"],
] as const;

export default function WalletForm() {
  const [name, setName] = useState("");
  const [kind, setKind] = useState("bank");
  const [note, setNote] = useState("");
  const [preview, setPreview] = useState(false);
  const [message, setMessage] = useState("");
  const [pending, startTransition] = useTransition();
  const kindLabel = kinds.find(([value]) => value === kind)?.[1];

  function confirm() {
    startTransition(async () => {
      const result = await createWalletAction({ name, kind, note });
      setMessage(result.message);
      if (result.ok) { setName(""); setNote(""); setPreview(false); }
    });
  }
  return <div className="space-y-3 text-xs">
    <div className="grid gap-3 sm:grid-cols-2">
      <label className="space-y-1"><span className="label">نام حساب / کیف‌پول</span><input className="field" value={name} onChange={e => setName(e.target.value)} placeholder="مثلاً بانک ملت" /></label>
      <label className="space-y-1"><span className="label">نوع حساب</span><select className="field" value={kind} onChange={e => setKind(e.target.value)}>{kinds.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
    </div>
    <label className="space-y-1 block"><span className="label">یادداشت (اختیاری)</span><input className="field" value={note} onChange={e => setNote(e.target.value)} /></label>
    {!preview ? <button className="btn btn-ghost" type="button" disabled={!name.trim()} onClick={() => setPreview(true)}>پیش‌نمایش</button> : <div className="soft rounded-xl p-3"><div className="muted mb-2">پیش‌نمایش — هنوز حسابی ایجاد نشده است</div><div className="flex items-center gap-2"><BankLogo name={name} size={28} /><strong>{name}</strong><span className="chip">{kindLabel}</span></div>{note && <div className="muted mt-1">{note}</div>}<div className="mt-3 flex gap-2"><button className="btn btn-primary" type="button" disabled={pending} onClick={confirm}>{pending ? "در حال ثبت…" : "تأیید نهایی و ایجاد حساب"}</button><button className="btn btn-ghost" type="button" onClick={() => setPreview(false)}>ویرایش</button></div></div>}
    {message && <p className="muted">{message}</p>}
  </div>;
}
