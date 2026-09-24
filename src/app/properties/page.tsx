import Link from "next/link";
import { ensureAuth } from "@/lib/authGuard";
import { listPropertyEconomics, type PropertyEconomics } from "@/features/properties/service";
import { EmptyState, PageHeader, Section } from "@/components/ui/Card";
import Icon from "@/components/ui/Icon";
import ModuleTabs, { ASSET_TABS } from "@/components/ui/ModuleTabs";
import { D } from "@/domain/decimal";
import { formatMoney, formatPct, formatSignedMoney, todayIso } from "@/lib/format";

export const dynamic = "force-dynamic";

export const metadata = { title: "درآمد و هزینه‌ی املاک" };

function PropertyCard({ p }: { p: PropertyEconomics }) {
  const net = D(p.net12);
  const q = (params: Record<string, string>) => `/new?${new URLSearchParams(params).toString()}`;
  return (
    <li className="card p-4">
      <div className="flex items-start gap-3">
        <span className="plan-icon" style={{ background: "var(--sunken)", color: "var(--text-2)" }} aria-hidden="true">
          <Icon name="home" size={16} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[length:var(--fs-sm)] font-semibold">{p.label}</p>
          <p className="muted text-[length:var(--fs-xs)]">
            اجاره و هزینه‌ها با برچسب <span dir="auto">{`#${p.tag}`}</span>
          </p>
        </div>
        {p.netYield != null && (
          <div className="shrink-0 text-left">
            <p className="num text-[length:var(--fs-sm)] font-semibold" style={{ color: D(p.netYield).isNegative() ? "var(--negative)" : "var(--positive)" }}>
              {formatPct(p.netYield, 1)}
            </p>
            <p className="muted text-[length:var(--fs-xs)]">بازده خالص سالانه</p>
          </div>
        )}
      </div>
      <dl className="reconcile-figures mt-3">
        {p.valueToman && (
          <div>
            <dt>ارزش روز</dt>
            <dd className="num money-nowrap" dir="rtl">{formatMoney(p.valueToman, "IRT")}</dd>
          </div>
        )}
        <div>
          <dt>اجاره‌ی ۱۲ ماه</dt>
          <dd className="num money-nowrap" dir="rtl">{formatMoney(p.rent12, "IRT")}</dd>
        </div>
        <div>
          <dt>هزینه‌ی ۱۲ ماه</dt>
          <dd className="num money-nowrap" dir="rtl">{formatMoney(p.costs12, "IRT")}</dd>
        </div>
        <div>
          <dt>خالص</dt>
          <dd className="num money-nowrap" dir="rtl" style={{ color: net.isNegative() ? "var(--negative)" : undefined }}>
            {formatSignedMoney(p.net12, "IRT")}
          </dd>
        </div>
        {p.grossYield != null && (
          <div>
            <dt>بازده ناخالص</dt>
            <dd className="num">{formatPct(p.grossYield, 1)}</dd>
          </div>
        )}
      </dl>
      <div className="mt-3 flex flex-wrap justify-end gap-2">
        <Link href={q({ type: "income", tags: `#${p.tag}` })} className="btn btn-soft !min-h-9 !px-3 text-[length:var(--fs-xs)]">
          <Icon name="arrow-up" size={13} />
          ثبت اجاره
        </Link>
        <Link href={q({ type: "expense", tags: `#${p.tag}` })} className="btn btn-ghost !min-h-9 !px-3 text-[length:var(--fs-xs)]">
          <Icon name="arrow-down" size={13} />
          ثبت هزینه
        </Link>
        <Link href={`/transactions?${new URLSearchParams({ tag: p.tag, range: "all" }).toString()}`} className="btn btn-ghost !min-h-9 !px-3 text-[length:var(--fs-xs)]">
          همه‌ی تراکنش‌ها
        </Link>
      </div>
    </li>
  );
}

export default async function PropertiesPage() {
  const user = await ensureAuth();
  const userId = (user as { id?: string } | null)?.id;
  if (!userId) {
    return (
      <div className="space-y-5">
        <PageHeader title="درآمد و هزینه‌ی املاک" />
        <div className="card">
          <EmptyState icon="lock" title="وارد شوید" />
        </div>
      </div>
    );
  }
  const list = await listPropertyEconomics(userId, todayIso());
  return (
    <div className="space-y-7">
      <div>
        <PageHeader title="درآمد و هزینه‌ی املاک" subtitle="اجاره، هزینه‌های نگه‌داری و بازده خالص هر ملک در ۱۲ ماه اخیر، نسبت به ارزش روز همان ملک." />
        <ModuleTabs tabs={ASSET_TABS} active="/asset-registry" label="بخش‌های دارایی" />
      </div>
      {list.length === 0 ? (
        <div className="card">
          <EmptyState
            icon="home"
            title="ملکی ثبت نشده است"
            action={
              <Link href="/asset-registry?kind=real-estate" className="btn btn-soft">
                ثبت ملک
              </Link>
            }
          />
        </div>
      ) : (
        <Section title="املاک">
          <ul className="grid gap-3">
            {list.map((p) => (
              <PropertyCard key={p.id} p={p} />
            ))}
          </ul>
        </Section>
      )}
      <p className="expense-sub flex items-center gap-1.5">
        <Icon name="info" size={13} />
        اجاره و هزینه‌ی هر ملک از تراکنش‌هایی می‌آید که برچسبش را دارند؛ قبض، شارژ، تعمیرات و مالیات ملک را با همین برچسب ثبت کنید. حق بیمه‌ی بیمه‌نامه‌های متصل به ملک خودکار حساب می‌شود.
      </p>
    </div>
  );
}
