import Link from "next/link";
import AssetLogo from "@/components/ui/AssetLogo";
import { Section } from "@/components/ui/Card";
import { faCount } from "@/lib/format";
import type { UnheldRegistration } from "@/features/portfolio/service";

/**
 * «ثبت شده، ولی خریدی وارد نشده» — the registrations that carry no position.
 *
 * WHY THIS SECTION EXISTS
 * The app separates an asset's IDENTITY from a POSITION in it, and that is
 * right: registering a fund is not buying one, and only a real transaction may
 * open a FIFO lot. But every asset page reads `getPortfolioValuation`, which
 * drops zero-quantity rows — so a user who registered eight funds and had not
 * yet entered their purchases saw eight empty screens and concluded the
 * feature did not work. Their work was not lost, only invisible.
 *
 * This makes it visible AND actionable: each row links straight into the
 * purchase flow, prefiltered to that asset. It deliberately does NOT show a
 * value, a price or a share — there is nothing to value yet, and inventing a
 * zero row in the totals is exactly what the valuation filter correctly avoids.
 *
 * PRESENTATION ONLY — the rows arrive already tenant-scoped from
 * `listRegisteredWithoutHoldings`; nothing is derived or re-queried here.
 */
export default function UnheldRegistrations({
  rows,
  title = "ثبت‌شده، بدون خرید",
}: {
  rows: UnheldRegistration[];
  title?: string;
}) {
  if (rows.length === 0) return null;

  return (
    <Section
      title={title}
      hint={`${faCount(rows.length)} مورد ثبت شده ولی هنوز خرید و مقداری برایشان وارد نشده — تا خرید ثبت نشود در ارزش خالص و سبد دارایی دیده نمی‌شوند.`}
    >
      <ul className="space-y-2">
        {rows.map((row) => (
          <li key={row.assetId} className="card flex flex-wrap items-center gap-3 p-3 sm:p-4">
            <AssetLogo symbol={row.symbol} name={row.name} size={30} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-[length:var(--fs-sm)] font-semibold">{row.name}</p>
              <p className="muted truncate text-[length:var(--fs-xs)]">
                {row.className} · نماد <span className="num">{row.symbol}</span>
              </p>
            </div>
            <Link
              href={`/new?type=buy&assetId=${row.assetId}`}
              className="btn btn-primary !min-h-9 !px-3.5 !py-1.5 text-[length:var(--fs-xs)]"
            >
              ثبت خرید
            </Link>
          </li>
        ))}
      </ul>
    </Section>
  );
}
