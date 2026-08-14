import type { Metadata } from "next";
import Link from "next/link";
import { LandingFooter, LandingHeader } from "@/components/landing/LandingChrome";

export const metadata: Metadata = {
  title: "درباره تراز",
  description: "چرا تراز ساخته شد؟ درآمد، هزینه، دارایی، بدهی، جریان نقدی و ارزش خالص شما در یک سیستم منسجم.",
};

export default function AboutPage() {
  return (
    <div className="landing">
      <LandingHeader />
      <article className="landing-legal">
        <p className="landing-kicker">تراز</p>
        <h1 className="type-page-title mt-2">چرا تراز ساخته شد؟</h1>
        <p className="sub mt-4 text-[15px] leading-8">
          پول شما فقط چند عدد در چند حساب مختلف نیست. تراز برای این ساخته شده است که درآمد، هزینه، دارایی، بدهی،
          جریان نقدی و ارزش خالص شما را در یک سیستم منسجم کنار هم قرار دهد؛ تا به‌جای حدس‌زدن درباره وضعیت مالی، آن
          را ببینید و درک کنید.
        </p>
        <p className="sub mt-4 text-[15px] leading-8">
          هسته این سیستم، حسابداری دوطرفه و دفترکل قابل بررسی است: هر عددی که می‌بینید، تا سند اصلی قابل پیگیری
          است. تراز یک Expense Tracker نیست؛ تصویر کامل پول، دارایی و ثروت شماست.
        </p>
        <p className="muted mt-4 text-[13px] leading-7">
          ما داستان ساختگی درباره بنیان‌گذاران یا سابقه شرکتی منتشر نمی‌کنیم؛ وقتی سند رسمی وجود داشته باشد، همین‌جا
          می‌آید.
        </p>
        <p className="mt-8">
          <Link href="/" className="font-semibold" style={{ color: "var(--brand)" }}>
            بازگشت به معرفی
          </Link>
        </p>
      </article>
      <LandingFooter />
    </div>
  );
}
