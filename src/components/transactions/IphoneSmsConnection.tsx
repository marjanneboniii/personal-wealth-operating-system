"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import SmsGuideSteps from "./SmsGuideSteps";
import { createIphoneConnectionAction, revokeIphoneConnectionAction } from "@/app/actions/bankSms";


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
  return <section className="card expense-card">
    <header className="expense-head"><h2>اتصال آیفون</h2><span className="expense-sub">قدم دوم</span></header>
    <p className="mb-3 text-sm">یک‌بار آیفون را تنظیم کنید؛ بعد از آن، پیامک‌های جدید بانکی به صندوق توازن می‌رسند. شما حساب و دسته را بررسی می‌کنید و تأیید می‌زنید؛ سپس تراکنش ثبت می‌شود.</p>
    {!endpoint && <p role="alert" className="mb-3 text-sm">آدرس امن اتصال هنوز برای این محیط آماده نیست. دریافت از آیفون پس از آماده‌شدن آدرس HTTPS فعال می‌شود.</p>}
    <fieldset disabled={pending || !endpoint} className="space-y-3">
      <label className="block"><span className="label">نام آیفون شما</span><input className="field" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} /></label>
      <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} /><span>اجازه می‌دهم پیامک‌های تراکنش انتخاب‌شده به حساب توازن من ارسال و تا بررسی، رمزگذاری‌شده نگهداری شوند. رمز، کد تأیید و اطلاعات ورود را نمی‌فرستم.</span></label>
      <button type="button" className="btn btn-primary w-full" disabled={!consent || !name.trim() || connections.length >= 5} onClick={create}>{pending ? "در حال انجام…" : "ساخت کلید اتصال آیفون"}</button>
    </fieldset>
    {token && <div className="expense-note mt-4 space-y-2"><p className="text-sm">این کلید فقط همین بار دیده می‌شود. مقدار زیر را کامل کپی کنید و در مرحلهٔ «اجازهٔ ارسال» قرار دهید. کلید را برای کسی نفرستید.</p><label className="block"><span className="label">کلید اتصال — مقدار Authorization</span><input className="field" dir="ltr" readOnly value={`Bearer ${token}`} onFocus={(e) => e.target.select()} /></label><button className="btn btn-ghost" type="button" onClick={() => setToken("")}>کلید را وارد کردم؛ پنهان کن</button></div>}
    <details className="sms-guide mt-4 text-sm" open={!!token}>
      <summary className="cursor-pointer">قدم سوم · تنظیم دریافت پیام روی آیفون</summary>
      <p className="sms-guide-intro">آیفون را بردارید و مراحل زیر را به ترتیب انجام دهید. نام انگلیسی گزینه‌ها را کنار توضیح فارسی آورده‌ایم تا راحت‌تر پیدایشان کنید.</p>
      <SmsGuideSteps steps={[
        { title: "برنامهٔ میان‌برها را باز کنید", content: <p>در آیفون، برنامهٔ <bdi dir="ltr">Shortcuts</bdi> را باز کنید. پایین صفحه روی <bdi dir="ltr">Automation</bdi> (اجرای خودکار) بزنید و با دکمهٔ + یک مورد جدید بسازید. سپس <bdi dir="ltr">Message</bdi> (پیام) را انتخاب کنید.</p> },
        { title: "پیامک‌های تراکنش را انتخاب کنید", content: <><p>در <bdi dir="ltr">Sender</bdi>، فرستندهٔ پیامک بانک را انتخاب کنید. در <bdi dir="ltr">Message Contains</bdi>، عبارتی از پیام تراکنش همان بانک، مثل «برداشت» یا «واریز»، بنویسید.</p><p>گزینهٔ <bdi dir="ltr">Run Immediately</bdi> (اجرای فوری) را انتخاب کنید. ادامه دهید و یک اجرای خالی با <bdi dir="ltr">New Blank Automation</bdi> بسازید. نام گزینه‌ها ممکن است در نسخهٔ iOS شما کمی متفاوت باشد.</p><p className="expense-note">فقط انتخاب فرستنده کافی نیست: پیام رمز هم ممکن است از همان شماره برسد. برای بانک‌ها یا عبارت‌های دیگر، همین تنظیم را جداگانه تکرار کنید.</p></> },
        { title: "متن پیام را بگیرید؛ رمزها را کنار بگذارید", content: <><p>در بخش افزودن اقدام، <bdi dir="ltr">Get Text from Input</bdi> را جست‌وجو کنید. ورودی آن را روی <bdi dir="ltr">Shortcut Input</bdi> بگذارید؛ یعنی همان پیام دریافتی. اگر ورودی از نوع Message است، ویژگی <bdi dir="ltr">Text</bdi> یا <bdi dir="ltr">Content</bdi> را انتخاب کنید.</p><p>اقدام <bdi dir="ltr">If</bdi> (اگر) اضافه کنید: اگر متن شامل «رمز»، «کد تأیید» یا عبارت مشابهِ پیام ورود بانک شما بود، با <bdi dir="ltr">Stop This Shortcut</bdi> اجرا را متوقف کنید. این بررسی را برای هر عبارت تکرار کنید؛ اقدامات بعدی باید پس از پایان این شرط‌ها باشند.</p></> },
        { title: "زمان دریافت را نگه دارید", content: <p>اقدام <bdi dir="ltr">Current Date</bdi> (زمان فعلی) را اضافه کنید. سپس <bdi dir="ltr">Format Date</bdi> را اضافه کرده و قالب تاریخ را <bdi dir="ltr">ISO 8601</bdi> بگذارید تا منطقهٔ زمانی هم ثبت شود. خروجی آن، زمان این پیام است.</p> },
        { title: "آدرس توازن را وارد کنید", content: <><p>اقدام <bdi dir="ltr">Get Contents of URL</bdi> را جست‌وجو و اضافه کنید. آدرس زیر را در قسمت URL قرار دهید. گزینه‌های بیشتر را باز کنید و <bdi dir="ltr">Method</bdi> را روی <bdi dir="ltr">POST</bdi> بگذارید.</p>{endpoint ? <label className="block mt-2"><span className="label">آدرس ارسال پیام — برای کپی لمس کنید</span><input className="field" dir="ltr" readOnly value={endpoint} onFocus={(e) => e.target.select()} /></label> : <p className="expense-note">آدرس اتصال هنوز آماده نیست؛ این مرحله را پس از آماده‌شدن آدرس انجام دهید.</p>}</> },
        { title: "اجازهٔ ارسال را تنظیم کنید", content: <><p>در بخش <bdi dir="ltr">Headers</bdi> دو ردیف اضافه کنید. نام‌ها و مقدارها را دقیقاً مثل زیر وارد کنید:</p><dl className="sms-settings"><div><dt><code>Authorization</code></dt><dd>کلید کاملِ بالای این راهنما، همراه با <bdi dir="ltr">Bearer</bdi> و فاصلهٔ بعد از آن</dd></div><div><dt><code>Content-Type</code></dt><dd><code>application/json</code></dd></div></dl><p>این کلید فقط برای فرستادن پیام است؛ اجازهٔ ثبت تراکنش نمی‌دهد.</p></> },
        { title: "متن و زمان پیام را به درخواست اضافه کنید", content: <><p>بخش <bdi dir="ltr">Request Body</bdi> را روی <bdi dir="ltr">JSON</bdi> بگذارید. با <bdi dir="ltr">Add new field</bdi> دو فیلد از نوع Text بسازید:</p><dl className="sms-settings"><div><dt><code>message</code></dt><dd>متغیر متن پیام از مرحلهٔ ۳</dd></div><div><dt><code>sentAt</code></dt><dd>متغیر تاریخِ قالب‌بندی‌شده از مرحلهٔ ۴</dd></div><div><dt><code>sender</code> (اختیاری)</dt><dd>نام بانک؛ مثلاً ملت</dd></div></dl><p className="expense-note">برای دو مقدار اول، متغیرِ خروجی مرحلهٔ مربوط را انتخاب کنید؛ عبارت «متن پیام» یا «زمان دریافت» را تایپ نکنید. نیازی به نوشتن کد یا کپی کردن یک قطعهٔ JSON نیست.</p></> },
        { title: "ذخیره کنید و اولین پیام را بررسی کنید", content: <><p>تنظیم را ذخیره کنید. با رسیدن یک پیامک تراکنش واقعیِ جدید، به توازن برگردید و «تازه‌سازی صندوق پیامک» را بزنید. دریافت در حالت قفل بودن آیفون را هم بررسی کنید.</p><p>پیام در صندوق پایین صفحه دیده می‌شود. حساب، مبلغ و دسته را بررسی کنید؛ تا تأیید نکنید، موجودی تغییر نمی‌کند.</p></> },
      ]} />
      <details className="sms-guide mt-3"><summary>پیام نرسید؟ این موارد را بررسی کنید</summary>
        <SmsGuideSteps steps={[
          { title: "اینترنت و اجازهٔ اجرا", content: <p>آیفون باید اینترنت داشته باشد. فرستنده و عبارت پیام، گزینهٔ اجرای فوری و مجوزهای Shortcuts را بررسی کنید. اجرای خودکار به نسخهٔ iOS و مجوزهای گوشی بستگی دارد.</p> },
          { title: "آدرس و کلید اتصال", content: <p>آدرس، روش POST و دو ردیف Headers را دوباره بررسی کنید. کلید باید کامل و همراه با Bearer باشد؛ اتصال لغوشده پیام نمی‌پذیرد.</p> },
          { title: "پاسخ ارسال", content: <p>پاسخ <code>ok: true</code> یعنی توازن پیام را دریافت کرده است. می‌توانید پاسخ را با اقدام <bdi dir="ltr">Show Notification</bdi> نمایش دهید. پیام دریافت‌شده هنوز نیاز به بررسی و تأیید شما دارد.</p> },
          { title: "ارسال ناموفق یا دوباره", content: <p>این نسخه پیام را هنگام قطع اینترنت در صف آیفون نگه نمی‌دارد. اگر همان پیام را دوباره می‌فرستید، همان زمان ذخیره‌شدهٔ مرحلهٔ ۴ را استفاده کنید؛ زمان تازه نسازید.</p> },
        ]} />
      </details>
      <a className="underline mt-3 inline-block" href="https://support.apple.com/en-ke/guide/shortcuts/apd602971e63/9.0/ios/26" target="_blank" rel="noreferrer">راهنمای تصویری اپل برای اجرای خودکار</a>
    </details>
    {message && <p role="status" className="mt-3 text-sm">{message}</p>}
    <div className="mt-4 space-y-2">{connections.map((c) => <div key={c.id} className="sms-connected-item"><span className="text-sm">{c.name} — {c.lastReceivedAt ? `آخرین دریافت: ${new Date(c.lastReceivedAt).toLocaleString("fa-IR")}` : "هنوز پیامی دریافت نشده"}</span><button className="btn btn-ghost" type="button" disabled={pending} onClick={() => revoke(c.id)}>لغو اتصال</button></div>)}</div>
    <div className="mt-4 flex flex-wrap items-center gap-3"><button className="btn btn-ghost" type="button" onClick={() => router.refresh()}>تازه‌سازی صندوق پیامک</button><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={autoRefresh} onChange={(e) => setAutoRefresh(e.target.checked)} />تازه‌سازی هر ۱۵ ثانیه هنگام بازبودن صفحه</label></div>
  </section>;
}
