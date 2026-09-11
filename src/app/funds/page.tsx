import Link from "next/link";
import InstrumentRegistrar from "@/components/funds/InstrumentRegistrar";

export const dynamic = "force-dynamic";

export const metadata = { title: "ثبت صندوق و سهام — توازن" };

export default function FundsPage() {
  return (
    <div className="mx-auto max-w-2xl space-y-5 py-6">
      <header className="space-y-2">
        <h1 className="text-[length:var(--fs-lg)] font-bold tracking-tight">
          ثبت صندوق سرمایه‌گذاری
        </h1>
        <p className="muted text-[length:var(--fs-sm)] leading-7">
          صندوق طلا، درآمد ثابت یا سهامی را جست‌وجو کنید و پس از پیش‌نمایش ثبت کنید. می‌توانید هر
          تعداد صندوق اضافه کنید.
        </p>
      </header>

      <InstrumentRegistrar />

      <p className="muted text-[length:var(--fs-xs)] leading-6">
        بعد از ثبت، خرید را از{" "}
        <Link href="/new?type=buy" className="font-medium">
          بخش تراکنش‌ها
        </Link>{" "}
        با تاریخ و مبلغ واقعی وارد کنید تا در ارزش خالص لحاظ شود.
      </p>
    </div>
  );
}
