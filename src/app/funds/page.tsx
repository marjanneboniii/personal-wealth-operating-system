import { PageHeader } from "@/components/ui/Card";
import Link from "next/link";
import AssetRegistrarTabs from "@/components/funds/AssetRegistrarTabs";
import { ensureAuth } from "@/lib/authGuard";

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
export default async function FundsPage() {
  await ensureAuth();
  return (
    <div className="mx-auto max-w-2xl space-y-5 py-6">
      <PageHeader title="ثبت دارایی" />

      <AssetRegistrarTabs />

      <p className="muted text-[length:var(--fs-xs)] leading-6">
        بعد از ثبت،{" "}
        <Link href="/new?type=buy" className="font-medium">
          خرید را ثبت کنید
        </Link>{" "}
        تا در ارزش خالص حساب شود.
      </p>
    </div>
  );
}
