"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Icon from "@/components/ui/Icon";
import SmsGuideSteps from "./SmsGuideSteps";
import { createIphoneConnectionAction, revokeIphoneConnectionAction } from "@/app/actions/bankSms";

type Connection = { id: string; name: string; createdAt: string; lastReceivedAt: string | null };

const En = ({ children }: { children: string }) => <bdi dir="ltr">{children}</bdi>;

/** Step 2 — a one-time iPhone automation that forwards each bank SMS. */
export default function IphoneSmsConnection({ connections, endpoint }: { connections: Connection[]; endpoint: string | null }) {
  const router = useRouter();
  const [name, setName] = useState("آیفون من");
  const [consent, setConsent] = useState(false);
  const [token, setToken] = useState("");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  async function create() {
    setPending(true); setMessage(""); setToken("");
    try {
      const result = await createIphoneConnectionAction({ name, consent });
      setMessage(result.message);
      if (result.ok) { setToken(result.token); router.refresh(); }
    } catch { setMessage("پاسخ دریافت نشد؛ پیش از تلاش دوباره صفحه را تازه کنید."); }
    finally { setPending(false); }
  }
  async function revoke(id: string) {
    if (!window.confirm("ارسال پیام از این آیفون قطع شود؟")) return;
    setPending(true);
    try { const result = await revokeIphoneConnectionAction(id); setMessage(result.message); if (result.ok) { setToken(""); router.refresh(); } }
    catch { setMessage("قطع اتصال انجام نشد؛ دوباره تلاش کنید."); }
    finally { setPending(false); }
  }
  const connected = connections.length > 0;
  const keyForm = <div className="space-y-3">
    {!connected && <p className="label">الف) کلید اتصال بسازید</p>}
    <fieldset disabled={pending || !endpoint} className="space-y-3">
      <label className="block"><span className="label">نام این آیفون</span><input className="field" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} /></label>
      <label className="flex items-start gap-2 text-sm leading-6"><input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} /><span>موافقم پیامک‌های تراکنش برای بررسی به توازن فرستاده و رمزگذاری‌شده نگه داشته شوند. پیامک رمز و کد تأیید فرستاده نمی‌شود.</span></label>
      <button type="button" className="btn btn-primary w-full" disabled={!consent || !name.trim() || connections.length >= 5} onClick={create}>{pending ? "در حال ساخت…" : "ساخت کلید اتصال"}</button>
    </fieldset>
    {token && <div className="expense-note space-y-2"><p className="text-sm">کلید فقط همین یک بار نشان داده می‌شود. کامل کپی کنید و در قدم «ب» استفاده کنید؛ برای کسی نفرستید.</p><label className="block"><span className="label">کلید (مقدار Authorization)</span><input className="field" dir="ltr" readOnly value={`Bearer ${token}`} onFocus={(e) => e.target.select()} /></label><button className="btn btn-ghost" type="button" onClick={() => setToken("")}>کپی کردم؛ پنهان کن</button></div>}
    </div>;

  return <section id="sms-iphone" className="card expense-card scroll-mt-20">
    <header className="expense-head"><h2 className="sms-step-title"><span className="sms-step-number is-2" aria-hidden="true">۲</span>اتصال آیفون</h2><span className="expense-sub">{connected ? "وصل شد" : "قدم دوم"}</span></header>
    <p className="text-sm leading-7">روی آیفون یک «اجرای خودکار» می‌سازید که هر پیامک بانک را برای توازن بفرستد. یک بار، حدود ۵ دقیقه.</p>

    {connected && <ul className="sms-connected-list">{connections.map((c) => <li key={c.id} className="sms-connected-item">
      <span className="flex min-w-0 items-center gap-2"><span className="sms-ok" aria-hidden="true"><Icon name="check" size={12} strokeWidth={3} /></span><span>{c.name} · {c.lastReceivedAt ? `آخرین پیام ${new Date(c.lastReceivedAt).toLocaleString("fa-IR", { dateStyle: "short", timeStyle: "short" })}` : "هنوز پیامی نرسیده"}</span></span>
      <button className="btn btn-ghost !min-h-9 !px-3 !py-1.5 text-[length:var(--fs-xs)]" type="button" disabled={pending} onClick={() => revoke(c.id)}>قطع اتصال</button>
    </li>)}</ul>}

    {!endpoint && <p role="alert" className="expense-note">آدرس امن (HTTPS) این نسخه هنوز آماده نیست؛ اتصال آیفون بعد از آن فعال می‌شود.</p>}

    {/* Once an iPhone is connected, a second key is a rare need: keep it folded. */}
    {connected ? <details className="sms-guide" open={!!token}><summary>افزودن آیفون دیگر</summary><div className="mt-4">{keyForm}</div></details> : keyForm}

    <details className="sms-guide text-sm" open={!!token}>
      <summary>ب) اجرای خودکار را روی آیفون بسازید</summary>
      <p className="sms-guide-intro">نام دکمه‌ها به انگلیسی آمده تا در آیفون راحت پیدایشان کنید.</p>
      <SmsGuideSteps steps={[
        { title: "یک اجرای خودکار تازه", content: <p>برنامهٔ <En>Shortcuts</En> ← <En>Automation</En> ← دکمهٔ + ← <En>Message</En>. در <En>Sender</En> بانک را انتخاب کنید و در <En>Message Contains</En> بنویسید «برداشت». گزینهٔ <En>Run Immediately</En> را روشن کنید و <En>New Blank Automation</En> را بزنید. برای «واریز» همین را یک بار دیگر بسازید.</p> },
        { title: "متن پیام، بدون رمزها", content: <p>اقدام <En>Get Text from Input</En> را با ورودی <En>Shortcut Input</En> اضافه کنید. بعد یک <En>If</En> بگذارید: اگر متن «رمز» یا «کد» داشت، <En>Stop This Shortcut</En>.</p> },
        { title: "زمان پیام", content: <p>اقدام <En>Current Date</En> و بعد <En>Format Date</En> را با قالب <En>ISO 8601</En> اضافه کنید.</p> },
        { title: "آدرس توازن", content: <><p>اقدام <En>Get Contents of URL</En> را اضافه کنید، آدرس زیر را بگذارید و <En>Method</En> را <En>POST</En> کنید.</p>{endpoint ? <input className="field mt-2" dir="ltr" readOnly value={endpoint} aria-label="آدرس ارسال پیام" onFocus={(e) => e.target.select()} /> : <p className="expense-note">آدرس هنوز آماده نیست.</p>}</> },
        { title: "کلید و نوع داده", content: <dl className="sms-settings"><div><dt>در <En>Headers</En>: <code>Authorization</code></dt><dd>کلید قدم «الف»، همراه با <En>Bearer</En></dd></div><div><dt>و <code>Content-Type</code></dt><dd><code>application/json</code></dd></div></dl> },
        { title: "متن و زمان را بفرستید", content: <><dl className="sms-settings"><div><dt>در <En>Request Body</En> (نوع <En>JSON</En>): <code>message</code></dt><dd>متغیر متن پیام از قدم ۲</dd></div><div><dt><code>sentAt</code></dt><dd>متغیر تاریخ از قدم ۳</dd></div></dl><p>ذخیره کنید. با اولین پیامک بانکی جدید، پیام در بخش ۳ همین صفحه می‌نشیند.</p></> },
      ]} />
      <details className="sms-guide mt-3"><summary>پیام نرسید؟</summary>
        <ul className="mt-3 list-disc space-y-2 ps-5 leading-7">
          <li>آیفون اینترنت داشته باشد و <En>Run Immediately</En> روشن باشد.</li>
          <li>آدرس، <En>POST</En> و دو ردیف <En>Headers</En> را دوباره نگاه کنید؛ کلید باید کامل و با <En>Bearer</En> باشد.</li>
          <li>برای دیدن پاسخ، اقدام <En>Show Notification</En> اضافه کنید؛ <code>ok: true</code> یعنی رسید.</li>
          <li>اگر اتصال را قطع کرده‌اید، کلید تازه بسازید.</li>
        </ul>
      </details>
      <a className="mt-3 inline-block underline" href="https://support.apple.com/en-ke/guide/shortcuts/apd602971e63/9.0/ios/26" target="_blank" rel="noreferrer">راهنمای تصویری اپل</a>
    </details>
    {message && <p role="status" className="text-sm">{message}</p>}
  </section>;
}
