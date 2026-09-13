import Link from "next/link";
import AssetLogo from "@/components/ui/AssetLogo";
import { Section } from "@/components/ui/Card";
import { faCount } from "@/lib/format";
import type { UnheldRegistration } from "@/features/portfolio/service";

/**
 * «ثبت‌شده، بدون خرید» — registered assets that carry no position yet.
 *
 * `getPortfolioValuation` correctly drops zero-quantity rows, so without this
 * list a user who registered funds but entered no purchase saw empty screens.
 * Each row links straight into the purchase flow for that asset. It shows no
 * value or share — there is nothing to value yet.
 *
 * PRESENTATION ONLY — rows arrive tenant-scoped from `listRegisteredWithoutHoldings`.
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
    <Section title={title} action={<span className="muted num text-[length:var(--fs-xs)]">{faCount(rows.length)}</span>}>
      <ul className="card unheld-list">
        {rows.map((row) => (
          <li key={row.assetId} className="unheld-row">
            <AssetLogo symbol={row.symbol} name={row.name} size={30} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-[length:var(--fs-sm)] font-semibold">{row.name}</p>
              <p className="muted truncate text-[length:var(--fs-xs)]">{row.className}</p>
            </div>
            <Link
              href={`/new?type=buy&assetId=${row.assetId}`}
              className="btn btn-soft !min-h-9 !px-3.5 !py-1.5 text-[length:var(--fs-xs)]"
            >
              ثبت خرید
            </Link>
          </li>
        ))}
      </ul>
    </Section>
  );
}
