import Link from "next/link";
import Icon from "@/components/ui/Icon";

export const metadata = { title: "آفلاین — وِزان" };

export default function OfflinePage() {
  return (
    <div className="flex min-h-[70dvh] flex-col items-center justify-center px-6 text-center">
      <span
        className="mb-4 flex h-14 w-14 items-center justify-center rounded-full"
        style={{ background: "var(--warning-soft)", color: "var(--warning)" }}
      >
        <Icon name="refresh" size={26} />
      </span>
      <h1 className="text-xl font-bold tracking-tight">آفلاین هستید</h1>
      <p className="muted mt-2 max-w-sm text-[13px] leading-6">
        این صفحه هنوز برای استفاده آفلاین ذخیره نشده است. صفحاتی که قبلاً باز کرده‌اید از حافظه دستگاه خوانده می‌شوند
        و داده‌های مالی شما هیچ‌وقت از بین نمی‌روند.
      </p>
      <div className="mt-5 flex gap-2">
        <Link href="/" className="btn btn-primary">
          نمای کلی ذخیره‌شده
        </Link>
      </div>
      <p className="muted mt-6 text-[11px]">پس از اتصال دوباره، همه‌چیز به‌روزرسانی می‌شود.</p>
    </div>
  );
}
