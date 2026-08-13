"use client";

import { useEffect } from "react";
import Link from "next/link";
import Icon from "@/components/ui/Icon";

/**
 * Financial software demands trust:
 * never lose the user's context, never show raw error codes,
 * always offer the last-known-good state.
 */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("[pwos] render error:", error);
  }, [error]);

  const isDb = /query|connect|ECONN|socket|database/i.test(String(error?.cause ?? error?.message ?? ""));

  return (
    <div className="flex min-h-[68dvh] flex-col items-center justify-center px-6 text-center">
      <span
        className="mb-4 flex h-14 w-14 items-center justify-center rounded-full"
        style={{ background: "var(--negative-soft)", color: "var(--negative)" }}
      >
        <Icon name="alert" size={26} />
      </span>
      <h1 className="text-xl font-bold tracking-tight">
        {isDb ? "نمی‌توانیم اطلاعات مالی را بخوانیم" : "مشکلی در نمایش این صفحه پیش آمد"}
      </h1>
      <p className="sub mt-2 max-w-md text-[13px] leading-6">
        {isDb
          ? "اتصال به پایگاه داده قطع است. داده‌های شما امن‌اند — هیچ چیزی حذف نشده. شاید سرور پایگاه داده خواب است؛ چند ثانیه دیگر دوباره تلاش کنید."
          : "یک خطای غیرمنتظره رخ داد. داده‌های مالی شما در دفترکل امن‌اند و این خطا هیچ تغییری در آن‌ها ایجاد نکرده است."}
      </p>
      <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
        <button onClick={reset} className="btn btn-primary">
          <Icon name="refresh" size={15} />
          تلاش دوباره
        </button>
        <Link href="/" className="btn">
          نمای کلی
        </Link>
        {/* Always offer a route that does not require a working database or a
            valid session, so a failed session lookup can never trap the user. */}
        <Link href="/login" className="btn">
          ورود به حساب
        </Link>
        <Link href="/settings" className="btn btn-ghost">
          بررسی تنظیمات
        </Link>
      </div>
      {error?.digest && (
        <p className="muted mt-6 text-[10.5px]" dir="ltr">
          کد پیگیری: {error.digest}
        </p>
      )}
    </div>
  );
}
