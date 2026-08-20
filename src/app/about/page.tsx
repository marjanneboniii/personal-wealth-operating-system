import type { Metadata } from "next";
import Link from "next/link";
import { LandingFooter, LandingHeader } from "@/components/landing/LandingChrome";

export const metadata: Metadata = {
  title: "درباره ما",
  description: "توازن برای دیدن یکپارچه ثروت شخصی ساخته شده است — دارایی، نقدینگی، تراکنش و ارزش خالص.",
};

export default function AboutPage() {
  return (
    <div className="landing">
      <LandingHeader />
    <article className="landing-legal">
      <p className="landing-kicker" style={{ color: "var(--color-primary)" }}>توازن</p>
      <h1 className="type-page-title mt-2">درباره ما</h1>
      <p className="sub mt-4 text-[15px] leading-8">
        توازن یک سیستم خصوصی مدیریت ثروت شخصی است. هدف آن این است که تصویر دارایی‌ها، بدهی‌ها، نقدینگی و تراکنش‌ها در یک
        جا جمع شود — روی هسته حسابداری دوطرفه، نه روی یک صفحه تبلیغاتی.
      </p>
      <p className="sub mt-4 text-[15px] leading-8">
        این محصول برای کسانی است که می‌خواهند وضعیت مالی‌شان را آرام و دقیق ببینند. ما داستان ساختگی درباره بنیان‌گذاران
        یا سابقه شرکتی منتشر نمی‌کنیم؛ وقتی سند رسمی وجود داشته باشد، همین‌جا می‌آید.
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
