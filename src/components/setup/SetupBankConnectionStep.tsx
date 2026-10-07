"use client";
import AssetLogo from "@/components/ui/AssetLogo";
import SmsChoices from "@/components/transactions/SmsChoices";
import type { SetupBankIdentifier } from "@/features/setup/bankConnection";

export default function SetupBankConnectionStep({ accountName, bankName, draft, onChange, onEditAccount }: {
 accountName: string; bankName: string; draft: SetupBankIdentifier | null; onChange: (draft: SetupBankIdentifier | null) => void; onEditAccount: () => void;
}) {
 const mismatch = draft && (draft.accountName !== accountName || draft.bankName !== bankName);
 return <section className="space-y-4"><div className="flex items-center gap-3"><AssetLogo name={bankName} assetType="bank" size={40} /><div><h3 className="font-semibold text-sm">{accountName || "حساب بانکی"}</h3><p className="muted text-xs">{bankName}</p></div></div>
  <div className="seg" role="group" aria-label="انتخاب اتصال پیامک"><button type="button" className={draft ? "seg-on" : ""} aria-pressed={!!draft} onClick={() => onChange({ accountName, bankName, kind: "card", suffix: "", ownershipConfirmed: false })}>معرفی شناسهٔ این حساب</button><button type="button" className={!draft ? "seg-on" : ""} aria-pressed={!draft} onClick={() => onChange(null)}>فعلاً بدون اتصال</button></div>
  {draft && <div className="card setup-row space-y-4">
   <div className="expense-note"><p>حساب معرفی‌شده: <b>{accountName}</b></p><p>بانک: <b>{bankName || "هنوز معرفی نشده"}</b></p><button type="button" className="btn btn-ghost mt-2" onClick={onEditAccount}>ویرایش حساب و بانک در مرحلهٔ ۲</button></div>
   {mismatch && <p className="expense-note expense-note-warn" role="alert">اطلاعات حساب تغییر کرده است. اتصال را برای حساب جدید دوباره انتخاب و بررسی کنید.</p>}
   {!bankName && <p className="expense-note expense-note-warn">ابتدا نام بانک را در مرحلهٔ حساب‌ها مشخص کنید.</p>}
   <SmsChoices label="شناسه‌ای که در پیامک نوشته می‌شود" value={draft.kind} options={[{ id: "card", name: "کارت" }, { id: "account", name: "حساب" }, { id: "iban", name: "شبا" }]} onChange={(kind) => onChange({ ...draft, kind: kind as SetupBankIdentifier["kind"], ownershipConfirmed: false })} />
   <label className="block"><span className="label">۴ تا ۸ رقم پایانی شناسه</span><input className="field num" value={draft.suffix} inputMode="numeric" maxLength={8} onChange={(event) => onChange({ ...draft, suffix: event.target.value, ownershipConfirmed: false })} placeholder="مثلاً ۱۲۳۴" /></label>
   <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={draft.ownershipConfirmed} onChange={(event) => onChange({ ...draft, ownershipConfirmed: event.target.checked })} /><span>بررسی کردم این کارت یا شناسه متعلق به همین حساب و بانک معرفی‌شده است.</span></label>
  </div>}
  <p className="expense-note">توازن دسترسی تأیید مالکیت از بانک ندارد؛ تطبیق اطلاعات با حساب و تأیید شما بررسی می‌شود. این مرحله فقط حساب دریافت‌کنندهٔ پیام را مشخص می‌کند؛ ساخت کلید و فعال‌سازی آیفون بعد از ثبت نهایی است.</p>
 </section>;
}
