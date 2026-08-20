import Link from "next/link";
import Icon from "@/components/ui/Icon";

export const metadata = { title: "آفلاین — وِزان" };

export default function OfflinePage() {
  return (
    <div className="flex min-h-[80dvh] flex-col items-center justify-center px-5 text-center" style={{ paddingBottom: "env(safe-area-inset-bottom)" }}>
      <span
        className="mb-4 flex h-14 w-14 items-center justify-center rounded-full"
        style={{ background: "var(--warning-soft)", color: "var(--warning)" }}
      >
        <Icon name="info" size={26} />
      </span>
      <p className="text-[15px] font-bold tracking-tight">وِزان</p>
      <h1 className="mt-3 text-xl font-bold tracking-tight">اتصال اینترنت برقرار نیست.</h1>
      <p className="muted mt-3 max-w-sm text-[13.5px] leading-7">
        اطلاعات مالی شما عمداً در حافظه آفلاین ذخیره نشده است.
      </p>
      <p className="muted mt-1 max-w-sm text-[13.5px] leading-7">پس از اتصال دوباره تلاش کنید.</p>
      <div className="mt-6">
        <Link href="/" className="btn btn-primary !min-h-12 px-6">
          تلاش دوباره
        </Link>
      </div>
    </div>
  );
}
