"use client";
import { useState } from "react";
import SmsGuideSteps from "./SmsGuideSteps";
import SmsCopyField from "./SmsCopyField";

const En = ({ children }: { children: string }) => <bdi dir="ltr">{children}</bdi>;
const TITLES = ["اجرای خودکار", "متن و زمان", "ارسال به توازن", "آزمایش دریافت"];

export default function IphoneSmsGuide({ endpoint, authorization, preview = false }: { endpoint?: string | null; authorization?: string; preview?: boolean }) {
  const [step, setStep] = useState(0);
  const steps = [
    [
      { title: "برنامهٔ Shortcuts را باز کنید", content: <p>در آیفون وارد <En>Shortcuts</En> شوید؛ پایین صفحه <En>Automation</En> و سپس + را بزنید. <En>Message</En> را انتخاب کنید.</p> },
      { title: "فرستندهٔ واقعی بانک را انتخاب کنید", content: <p>در <En>Sender</En> شماره یا نام فرستنده را دقیقاً از پیامک بانک انتخاب کنید؛ نام بانک در توازن با فرستندهٔ پیامک یکسان نیست. در <En>Message Contains</En> یک عبارت موجود در پیامک تراکنش خود، مثلاً «برداشت»، بنویسید. هر دو شرط باید با پیام جدید مطابقت داشته باشند.</p> },
      { title: "اجرای بدون تأیید", content: <p><En>Run Immediately</En> را انتخاب کنید، <En>Next</En> و سپس <En>New Blank Automation</En> را بزنید. در نسخه‌هایی که <En>Ask Before Running</En> دارند، آن را خاموش کنید. اگر فقط اجرای با تأیید در دسترس است، برای هر پیام باید اجرا را تأیید کنید.</p> },
    ],
    [
      { title: "خودِ متن پیام را بگیرید", content: <p>اقدام <En>Get Text from Input</En> را اضافه کنید. ورودی را روی متغیر <En>Shortcut Input</En> بگذارید. اگر ورودی از نوع <En>Message</En> است، ویژگی <En>Content</En> (متن پیام) را انتخاب کنید؛ شمارهٔ فرستنده یا عنوان پیام کافی نیست.</p> },
      { title: "پیام رمز را نفرستید", content: <p>یک <En>If</En> اضافه کنید: اگر متن شامل «رمز» است، <En>Stop This Shortcut</En>. همین شرط را برای «کد تأیید»، «کد تایید» و «کد فعال» نیز اضافه کنید. شرط عمومی «کد» نگذارید؛ ممکن است پیام تراکنش کد پیگیری داشته باشد.</p> },
      { title: "تاریخ را به قالب درست تبدیل کنید", content: <p><En>Current Date</En> و بعد <En>Format Date</En> را اضافه کنید. قالب را <En>ISO 8601</En> بگذارید. برای ارسال، خروجی تاریخ قالب‌بندی‌شده را انتخاب کنید؛ تاریخ شمسی یا متن تایپ‌شده قابل قبول نیست.</p> },
    ],
    [
      { title: "آدرس و روش ارسال", content: <><p>اقدام <En>Get Contents of URL</En> را اضافه کنید. آدرس زیر را در URL بگذارید، تنظیمات بیشتر را باز کنید و <En>Method</En> را <En>POST</En> قرار دهید.</p>{endpoint ? <SmsCopyField label="آدرس دریافت پیام" value={endpoint} /> : <p className="expense-note">{preview ? "آدرس مخصوص توازن بعد از ثبت نهایی، در مرحلهٔ اتصال آیفون نمایش داده می‌شود." : "آدرس دریافت پیام آماده نیست."}</p>}</> },
      { title: "دو ردیف Headers", content: <><dl className="sms-settings"><div><dt><En>Authorization</En></dt><dd>کلید اتصال را کامل، با پیشوند <En>Bearer </En> وارد کنید؛ فقط یک فاصله بین Bearer و کلید باشد.</dd></div><div><dt><En>Content-Type</En></dt><dd><En>application/json</En></dd></div></dl>{authorization && <SmsCopyField label="مقدار Authorization" value={authorization} secret />}</> },
      { title: "دو فیلد در Request Body", content: <><p>نوع بدنه را <En>JSON</En> انتخاب کنید. با <En>Add new field</En> این دو فیلد از نوع <En>Text</En> را اضافه کنید؛ نام‌ها دقیق و با همین حروف کوچک باشند.</p><dl className="sms-settings"><div><dt><En>message</En></dt><dd>متغیر خروجی <En>Get Text from Input</En> از بخش قبل؛ کل متن پیام، نه عبارت «برداشت».</dd></div><div><dt><En>sentAt</En></dt><dd>متغیر خروجی <En>Format Date</En> با قالب ISO 8601.</dd></div></dl><p>متغیرها را از انتخاب‌گر متغیر آیفون بگیرید؛ کلمهٔ Shortcut Input یا Current Date را تایپ نکنید. فیلد دیگری لازم نیست.</p></> },
    ],
    [
      { title: "پاسخ ارسال را ببینید", content: <p>بعد از <En>Get Contents of URL</En>، اقدام <En>Show Result</En> را با خروجی همان درخواست اضافه کنید. هنگام اجرای آزمایشی، اگر اجازهٔ دسترسی به دامنهٔ توازن خواسته شد، اجازه دهید. پاسخ <En>ok: true</En> یعنی پیام پذیرفته شده است.</p> },
      { title: "با یک پیام جدید بررسی کنید", content: <p>اتوماسیون را با <En>Done</En> ذخیره کنید. با پیامک تراکنش جدید، به توازن برگردید و «بررسی دریافت پیام» را بزنید. اجرای دستی بدون ورودی پیام ممکن است خطا بدهد؛ پیام قدیمیِ منظورشده در موجودی اولیه را دوباره نفرستید.</p> },
      { title: "واریز و بانک‌های دیگر", content: <p>پس از موفقیت، همین اتوماسیون را برای عبارت «واریز» یا عبارت واقعی پیام بانک خود نیز بسازید. برای بانک دیگر فرستندهٔ آن بانک را انتخاب کنید. تا پیام را در صندوق توازن تأیید نکنید، موجودی تغییر نمی‌کند.</p> },
    ],
  ];
  return <div className="sms-walkthrough">
    {preview && <p className="expense-note">این پیش‌نمایش مراحل آیفون است. پس از تأیید نهایی اطلاعات مالی، کلید می‌سازید و همین مراحل را ادامه می‌دهید.</p>}
    <div className="sms-guide-tabs" role="group" aria-label="بخش‌های راهنمای آیفون">{TITLES.map((title, index) => <button type="button" key={title} aria-pressed={step === index} onClick={() => setStep(index)}><span>{(index + 1).toLocaleString("fa-IR")}</span>{title}</button>)}</div>
    <p className="sms-guide-intro">بخش {(step + 1).toLocaleString("fa-IR")} از ۴ · نام دکمه‌های آیفون به انگلیسی نوشته شده است.</p>
    <SmsGuideSteps steps={steps[step]} />
    <div className="sms-guide-nav"><button className="btn btn-ghost" type="button" disabled={step === 0} onClick={() => setStep(step - 1)}>قبلی</button><button className="btn btn-primary" type="button" disabled={step === 3} onClick={() => setStep(step + 1)}>ادامه: {TITLES[step + 1] ?? "پایان راهنما"}</button></div>
    <a className="re-link text-xs" href="https://support.apple.com/guide/shortcuts/communication-triggers-apdd711f9dff/ios" target="_blank" rel="noreferrer">راهنمای رسمی Shortcuts اپل</a>
  </div>;
}
