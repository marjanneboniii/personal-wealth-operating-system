import Link from "next/link";
import Icon from "@/components/ui/Icon";

export default function NotFound() {
  return (
    <div className="flex min-h-[68dvh] flex-col items-center justify-center px-6 text-center">
      <span
        className="mb-4 flex h-14 w-14 items-center justify-center rounded-full"
        style={{ background: "var(--brand-soft)", color: "var(--brand)" }}
      >
        <Icon name="search" size={26} />
      </span>
      <h1 className="text-xl font-bold tracking-tight">این صفحه وجود ندارد</h1>
      <p className="muted mt-2 max-w-sm text-[13px] leading-6">
        آدرس را بررسی کنید یا از مرکز فرمان استفاده کنید — در دسکتاپ <kbd className="kbd">⌘</kbd> <kbd className="kbd">K</kbd> را بزنید.
      </p>
      <div className="mt-6 flex gap-2">
        <Link href="/" className="btn btn-primary">
          بازگشت به نمای کلی
        </Link>
        <Link href="/reports" className="btn">
          گزارش‌ها
        </Link>
      </div>
    </div>
  );
}
