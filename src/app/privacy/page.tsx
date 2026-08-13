import type { Metadata } from "next";
import Link from "next/link";
import { LandingFooter, LandingHeader } from "@/components/landing/LandingChrome";

export const metadata: Metadata = {
  title: "حریم خصوصی",
  description: "نحوه برخورد تراز با حساب کاربری، نشست و داده‌های مالی شما.",
};

export default function PrivacyPage() {
  return (
    <div className="landing">
      <LandingHeader />
    <article className="landing-legal">
      <h1 className="type-page-title">حریم خصوصی</h1>
      <p className="sub mt-4 text-[15px] leading-8">
        داده‌های مالی به حساب شما وابسته‌اند و از طریق نشست سروری در دسترس قرار می‌گیرند. نشست با خروج یا انقضا پایان
        می‌یابد. صفحات مالی خصوصی در حافظهٔ آفلاین مرورگر ذخیره نمی‌شوند.
      </p>
      <p className="sub mt-4 text-[15px] leading-8">
        پشتیبان‌گیری و بازیابی فقط برای نقش‌های مجاز در تنظیمات در دسترس است. این صفحه گواهی امنیتی شخص ثالث ادعا نمی‌کند.
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
