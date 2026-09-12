import Link from "next/link";
import AssetRegistrarTabs from "@/components/funds/AssetRegistrarTabs";

export const dynamic = "force-dynamic";

export const metadata = { title: "ثبت دارایی — توازن" };

/**
 * ثبت دارایی — one screen for every instrument the user can hold.
 *
 * The page used to register funds only, which is why «سهام بورسی» in the
 * onboarding checklist led here and then could not do the thing it promised,
 * and why crypto/tokenised metals were reachable only from inside the purchase
 * form. Registration is now one destination with three sources behind it:
 *
 *   صندوق · سهام بورسی   → the hand-maintained TSE catalogue (manual pricing)
 *   رمزارز · فلز توکنیزه  → the والکس catalogue, Persian-named, live قیمت
 *                           تومانی AND قیمت تتری
 *
 * Registering is never buying: it creates the identity and the tenant's asset
 * account at zero. The purchase form stays the only path into accounting.
 */
export default function FundsPage() {
  return (
    <div className="mx-auto max-w-2xl space-y-5 py-6">
      <header className="space-y-2">
        <h1 className="text-[length:var(--fs-lg)] font-bold tracking-tight">ثبت دارایی</h1>
        <p className="muted text-[length:var(--fs-sm)] leading-7">
          صندوق سرمایه‌گذاری، سهام بورسی، رمزارز یا فلز توکنیزه را جست‌وجو کنید و ثبت کنید.
          می‌توانید هر تعداد مورد اضافه کنید.
        </p>
      </header>

      <AssetRegistrarTabs />

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
