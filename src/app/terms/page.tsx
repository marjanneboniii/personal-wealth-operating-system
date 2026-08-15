import type { Metadata } from "next";
import Link from "next/link";
import { LandingFooter, LandingHeader } from "@/components/landing/LandingChrome";

export const metadata: Metadata = {
  title: "شرایط استفاده",
  description: "شرایط استفاده از وِزان به‌عنوان سیستم مدیریت ثروت شخصی.",
};

export default function TermsPage() {
  return (
    <div className="landing">
      <LandingHeader />
      <article className="landing-legal">
        <h1 className="type-page-title">شرایط استفاده</h1>
        <p className="sub mt-4 text-[15px] leading-8">
          وِزان ابزاری برای ثبت و مشاهده وضعیت مالی شخصی است، نه مشاور سرمایه‌گذاری و نه مؤسسه مالی. شما مسئول صحت
          اطلاعاتی هستید که وارد می‌کنید و تصمیم‌هایی که بر اساس آن می‌گیرید.
        </p>
        <p className="sub mt-4 text-[15px] leading-8">
          ایجاد حساب به معنای پذیرش همین محدوده است. جزئیات حقوقی تکمیلی وقتی متن رسمی وجود داشته باشد به این صفحه اضافه
          می‌شود.
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
