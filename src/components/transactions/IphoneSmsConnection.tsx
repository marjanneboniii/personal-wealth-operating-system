"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Icon from "@/components/ui/Icon";
import IphoneSmsGuide from "./IphoneSmsGuide";
import SmsCopyField from "./SmsCopyField";
import { createIphoneConnectionAction, revokeIphoneConnectionAction } from "@/app/actions/bankSms";

type Connection = { id: string; name: string; createdAt: string; lastReceivedAt: string | null };

export default function IphoneSmsConnection({ connections, endpoint, unavailableReason }: {
  connections: Connection[]; endpoint: string | null; unavailableReason?: string | null;
}) {
  const router = useRouter();
  const [name, setName] = useState("آیفون من");
  const [consent, setConsent] = useState(false);
  const [token, setToken] = useState("");
  const [started, setStarted] = useState(false);
  const [pending, setPending] = useState(false);
  const [refreshing, startRefresh] = useTransition();
  const [message, setMessage] = useState("");
  const connected = connections.length > 0;
  const received = connections.some((connection) => connection.lastReceivedAt);
  const blocked = unavailableReason || (!endpoint ? "آدرس امن دریافت پیام در این نسخه آماده نیست." : null);

  async function create() {
    if (pending || blocked || token) return;
    setPending(true); setMessage("");
    try {
      const result = await createIphoneConnectionAction({ name, consent });
      setMessage(result.message);
      if (result.ok) { setToken(result.token); router.refresh(); }
    } catch { setMessage("پاسخ دریافت نشد. صفحه را تازه کنید و فهرست کلیدها را بررسی کنید؛ ممکن است کلید ساخته شده باشد."); }
    finally { setPending(false); }
  }
  async function revoke(id: string) {
    if (pending || !window.confirm("کلید این آیفون لغو شود؟ اتوماسیون آن را هم در Shortcuts خاموش کنید.")) return;
    setPending(true);
    try { const result = await revokeIphoneConnectionAction(id); setMessage(result.message); if (result.ok) { setToken(""); router.refresh(); } }
    catch { setMessage("قطع اتصال انجام نشد؛ دوباره تلاش کنید."); }
    finally { setPending(false); }
  }
  const keyForm = <div className="space-y-3">
    <fieldset disabled={pending || !!blocked || !!token} className="space-y-3">
      <label className="block"><span className="label">نام دستگاه</span><input className="field" value={name} maxLength={60} onChange={(event) => setName(event.target.value)} /></label>
      <label className="flex items-start gap-2 text-sm leading-6"><input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} /><span>موافقم پیامک‌های تراکنش برای بررسی به توازن ارسال و رمزگذاری‌شده نگه داشته شوند. در Shortcuts، پیام‌های رمز و کد تأیید را از ارسال کنار می‌گذارم.</span></label>
      <button type="button" className="btn btn-primary w-full" disabled={!consent || !name.trim() || connections.length >= 5} onClick={create}>{pending ? "در حال ساخت کلید…" : "ساخت کلید برای این آیفون"}</button>
      {connections.length >= 5 && <p className="expense-note">۵ دستگاه کلید دارند؛ برای افزودن دستگاه، ابتدا کلید دستگاه قدیمی را لغو کنید.</p>}
    </fieldset>
  </div>;

  return <section id="sms-iphone" className="card expense-card scroll-mt-20">
    <header className="expense-head"><h2 className="sms-step-title"><span className="sms-step-number is-2" aria-hidden="true">۲</span>فعال‌سازی روی آیفون</h2><span className={`badge ${received ? "badge-positive" : "badge-neutral"}`}>{received ? "دریافت پیام تأیید شد" : connected || token ? "کلید آماده؛ منتظر پیام" : "هنوز فعال نشده"}</span></header>
    <div className="sms-activation-intro"><span className="flow-icon" aria-hidden="true"><Icon name="phone" size={24} /></span><div><h3 className="font-semibold">پیام بانک، آمادهٔ بررسی در توازن</h3><p className="muted text-sm leading-7">یک بار Shortcuts آیفون را تنظیم می‌کنید. پیام‌های جدید وارد صندوق می‌شوند و با تأیید شما به تراکنش تبدیل می‌شوند.</p></div></div>
    {blocked && <p role="alert" className="expense-note expense-note-warn">{blocked}</p>}
    {!connected && !token && !started && <><button type="button" className="btn btn-primary w-full" disabled={!!blocked} onClick={() => setStarted(true)}>شروع اتصال پیامک آیفون</button><p className="muted text-xs">ساخت کلید، تنظیم Shortcuts و بررسی اولین پیام · هر زمان قابل قطع است.</p></>}
    {(started && !connected && !token) && keyForm}
    {connected && <ul className="sms-connected-list">{connections.map((connection) => <li key={connection.id} className="sms-connected-item">
      <span className="flex min-w-0 items-center gap-2"><Icon name={connection.lastReceivedAt ? "check" : "phone"} size={18} /><span><b>{connection.name}</b><br />{connection.lastReceivedAt ? `آخرین دریافت: ${new Date(connection.lastReceivedAt).toLocaleString("fa-IR", { dateStyle: "short", timeStyle: "short" })}` : "کلید ساخته شده؛ هنوز پیامی از این دستگاه نرسیده"}</span></span>
      <button className="btn btn-ghost text-xs" type="button" disabled={pending} onClick={() => revoke(connection.id)}>لغو کلید</button>
    </li>)}</ul>}
    {token && <div className="sms-token-card space-y-3"><h3 className="font-semibold text-sm">کلید آماده است؛ حالا Shortcuts را تنظیم کنید</h3><p className="text-sm leading-7">این کلید فقط همین بار نمایش داده می‌شود. با دکمهٔ کپی، مقدار کامل را در Authorization بگذارید. آن را برای کسی نفرستید؛ با بستن یا تازه‌کردن صفحه دوباره قابل نمایش نیست.</p><SmsCopyField label="Authorization · همراه با Bearer" value={`Bearer ${token}`} secret /><button className="btn btn-ghost" type="button" onClick={() => setToken("")}>در Shortcuts ذخیره کردم؛ پنهان کن</button></div>}
    {connected && !token && <details className="sms-guide"><summary>کلید را ندارم یا آیفون دیگری اضافه می‌کنم</summary><p className="text-sm leading-7 my-3">کلید قبلی بازیابی نمی‌شود. اگر آن را گم کرده‌اید، کلید همان دستگاه را از فهرست بالا لغو کنید، کلید تازه بسازید و Authorization را در همهٔ اتوماسیون‌های آن دستگاه تغییر دهید.</p>{keyForm}</details>}
    {endpoint && <SmsCopyField label="آدرس دریافت پیام در توازن" value={endpoint} />}
    <details className="sms-guide" open={!!token || started || connected}><summary>راهنمای قدم‌به‌قدم Shortcuts</summary><IphoneSmsGuide endpoint={endpoint} authorization={token ? `Bearer ${token}` : undefined} /></details>
    {(connected || token) && <div className="sms-receipt-check"><p className="text-sm leading-7">{received ? "دریافت از آیفون ثبت شده است. پیام‌های منتظر را در صندوق همین صفحه بررسی کنید." : "ساخت کلید به‌تنهایی اتصال را تأیید نمی‌کند. بعد از رسیدن پیامک بانکی جدید، دریافت را بررسی کنید."}</p><button type="button" className="btn btn-primary" disabled={refreshing} onClick={() => startRefresh(() => router.refresh())}><Icon name="refresh" size={16} />{refreshing ? "در حال بررسی…" : "بررسی دریافت پیام"}</button></div>}
    <details className="sms-guide"><summary>پیام نرسیده یا Shortcuts خطا می‌دهد؟</summary><div className="sms-settings text-sm leading-7">
      <div><b>اتوماسیون اصلاً اجرا نمی‌شود</b><p>فرستنده باید دقیقاً با پیام بانک یکی باشد؛ همهٔ شرط‌های Sender و Message Contains باید برقرار باشند. Run Immediately، اینترنت آیفون و مجوز دسترسی به دامنهٔ توازن را بررسی کنید. پیام قدیمی اتوماسیون را فعال نمی‌کند.</p></div>
      <div><b>INVALID_CONNECTION · خطای 401</b><p>Authorization را کامل با Bearer و یک فاصله وارد کنید. کلید لغوشده کار نمی‌کند؛ از کلید دستگاه فعال استفاده کنید.</p></div>
      <div><b>INVALID_PAYLOAD یا JSON_REQUIRED · خطای 400 یا 415</b><p>روش POST، نوع JSON، نام‌های message و sentAt و تاریخ ISO 8601 را بررسی کنید. مقدار message باید متن واقعی پیام و sentAt خروجی Format Date باشد.</p></div>
      <div><b>BEFORE_ACTIVATION یا INVALID_TIME</b><p>پیام باید بعد از ساخت کلید رسیده باشد؛ تاریخ و ساعت آیفون را خودکار تنظیم کنید. پیام قدیمی را برای آزمایش نفرستید.</p></div>
      <div><b>NOT_A_TRANSACTION</b><p>پیام شامل رمز یا کد تأیید است و پذیرفته نمی‌شود. پیام تراکنش جدید را بررسی کنید.</p></div>
      <div><b>INBOX_FULL، RATE_LIMITED یا SERVICE_UNAVAILABLE</b><p>پیام‌های منتظر را بررسی کنید؛ برای محدودیت ارسال کمی بعد تلاش کنید. اگر سرویس در دسترس نیست، اتصال را بعداً بررسی کنید؛ کلید جدید مشکل سرویس را برطرف نمی‌کند.</p></div>
    </div></details>
    {message && <p role="status" className="expense-note text-sm">{message}</p>}
  </section>;
}
