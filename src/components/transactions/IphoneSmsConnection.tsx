"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createIphoneConnectionAction, revokeIphoneConnectionAction } from "@/app/actions/bankSms";
import { Card } from "@/components/ui/Card";

type Connection = { id: string; name: string; createdAt: string; lastReceivedAt: string | null };
export default function IphoneSmsConnection({ connections, endpoint }: { connections: Connection[]; endpoint: string | null }) {
  const router = useRouter();
  const [name, setName] = useState("آیفون من");
  const [consent, setConsent] = useState(false);
  const [token, setToken] = useState("");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [autoRefresh, setAutoRefresh] = useState(false);
  useEffect(() => {
    if (!autoRefresh) return;
    const id = window.setInterval(() => { if (document.visibilityState === "visible") router.refresh(); }, 15_000);
    return () => window.clearInterval(id);
  }, [autoRefresh, router]);
  async function create() {
    setPending(true); setMessage(""); setToken("");
    try {
      const result = await createIphoneConnectionAction({ name, consent });
      setMessage(result.message);
      if (result.ok) { setToken(result.token); router.refresh(); }
    } catch { setMessage("پاسخ دریافت نشد؛ پیش از تلاش دوباره فهرست اتصال‌ها را تازه‌سازی کنید."); }
    finally { setPending(false); }
  }
  async function revoke(id: string) {
    if (!window.confirm("ارسال پیام از این اتصال متوقف شود؟")) return;
    setPending(true);
    try { const result = await revokeIphoneConnectionAction(id); setMessage(result.message); if (result.ok) { setToken(""); router.refresh(); } }
    catch { setMessage("لغو انجام نشد؛ دوباره تلاش کنید."); }
    finally { setPending(false); }
  }
  return <Card title="اتصال خودکار پیامک آیفون با Shortcuts">
    <p className="mb-3 text-sm">پس از راه‌اندازی اولیه توازن، یک‌بار اتوماسیون را روی آیفون تنظیم کنید. پیام‌های جدید خودکار به صندوق بازبینی این حساب در وب و PWA می‌رسند؛ ثبت مالی پس از انتخاب دسته و تأیید شما انجام می‌شود.</p>
    {!endpoint && <p role="alert" className="mb-3 text-sm">آدرس امن اتصال هنوز برای این محیط آماده نیست. دریافت از آیفون پس از آماده‌شدن آدرس HTTPS فعال می‌شود.</p>}
    <fieldset disabled={pending || !endpoint} className="space-y-3">
      <label className="block"><span className="label">نام دستگاه</span><input className="field" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} /></label>
      <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} /><span>موافقم متن پیامک‌های تراکنش بانکی انتخاب‌شده به حساب توازن من ارسال و تا بازبینی به‌صورت رمزگذاری‌شده نگهداری شود. پیام‌های رمز، تأیید و اطلاعات ورود را ارسال نمی‌کنم.</span></label>
      <button type="button" className="btn btn-primary" disabled={!consent || !name.trim() || connections.length >= 5} onClick={create}>{pending ? "در حال انجام…" : "ساخت کلید اتصال آیفون"}</button>
    </fieldset>
    {token && <div className="mt-4 space-y-2"><p className="text-sm">کلید فقط همین بار نمایش داده می‌شود. آن را در Shortcuts قرار دهید؛ در لینک، پیام یا تصویر منتشر نکنید.</p><label className="block"><span className="label">Authorization</span><input className="field" dir="ltr" readOnly value={`Bearer ${token}`} onFocus={(e) => e.target.select()} /></label><button className="btn btn-ghost" type="button" onClick={() => setToken("")}>کلید را وارد کردم؛ پنهان کن</button></div>}
    <details className="mt-4 text-sm" open={!!token}><summary className="cursor-pointer">راهنمای تنظیم یک‌باره روی آیفون</summary>
      <ol className="mt-3 list-decimal space-y-3 ps-5">
        <li>در Shortcuts وارد Automation شوید و یک اتوماسیون Message بسازید. فرستنده بانک یا عبارت مشخص پیام تراکنش را انتخاب کنید؛ برای بانک‌های دیگر نیز جداگانه تنظیم کنید. گزینه Run Immediately را فعال کنید.</li>
        <li>متن پیام دریافتی را از Shortcut Input بگیرید؛ اگر ورودی از نوع Message است، ویژگی Text یا Content آن را انتخاب کنید. پیام رمز و کد تأیید را با شرط If کنار بگذارید.</li>
        <li>Current Date را اضافه کنید و با Format Date، قالب ISO 8601 شامل منطقه زمانی بسازید. این زمان را یک‌بار برای همان پیام نگه دارید.</li>
        <li>Get Contents of URL را اضافه کنید: آدرس زیر، روش POST و Request Body از نوع JSON. در Headers، مقدار Authorization را از کلید بالا و Content-Type را application/json قرار دهید.</li>
      </ol>
      {endpoint && <input className="field mt-3" dir="ltr" readOnly value={endpoint} onFocus={(e) => e.target.select()} />}
      <pre dir="ltr" className="mt-3 overflow-x-auto whitespace-pre-wrap">{'{\n  "message": [Text of Shortcut Input],\n  "sender": "نام بانک",\n  "sentAt": [Formatted Date: ISO 8601]\n}'}</pre>
      <p className="mt-2">برای message و sentAt متغیرهای واقعی Shortcuts را انتخاب کنید؛ عبارت‌های داخل کروشه متن ثابت نیستند. sender اختیاری است. کلید فقط اجازه ارسال پیام دارد.</p>
      <p className="mt-2">پاسخ ok: true یعنی پیام دریافت شده است. هنگام خطا، Show Notification را اجرا کنید. اتصال اینترنت لازم است؛ ارسال دوباره همان پیام باید با همان sentAt باشد. این نسخه صف آفلاین روی آیفون ندارد.</p>
      <p className="mt-2">ابتدا با پیام تراکنش واقعی پس از فعال‌سازی آزمایش کنید و دریافت هنگام قفل‌بودن گوشی را نیز بررسی کنید. امکان اجرا به نسخه iOS و مجوزهای اقدامات Shortcuts بستگی دارد.</p>
      <a className="underline mt-2 inline-block" href="https://support.apple.com/en-ke/guide/shortcuts/apd602971e63/9.0/ios/26" target="_blank" rel="noreferrer">راهنمای رسمی اتوماسیون اپل</a>
    </details>
    {message && <p role="status" className="mt-3 text-sm">{message}</p>}
    <div className="mt-4 space-y-2">{connections.map((c) => <div key={c.id} className="flex flex-wrap items-center justify-between gap-2"><span className="text-sm">{c.name} — {c.lastReceivedAt ? `آخرین دریافت: ${new Date(c.lastReceivedAt).toLocaleString("fa-IR")}` : "هنوز پیامی دریافت نشده"}</span><button className="btn btn-ghost" type="button" disabled={pending} onClick={() => revoke(c.id)}>لغو اتصال</button></div>)}</div>
    <div className="mt-4 flex flex-wrap items-center gap-3"><button className="btn btn-ghost" type="button" onClick={() => router.refresh()}>تازه‌سازی صندوق پیامک</button><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={autoRefresh} onChange={(e) => setAutoRefresh(e.target.checked)} />تازه‌سازی هر ۱۵ ثانیه هنگام بازبودن صفحه</label></div>
  </Card>;
}
