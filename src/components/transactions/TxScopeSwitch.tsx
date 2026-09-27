import Link from "next/link";
import Icon from "@/components/ui/Icon";
import { faCount } from "@/lib/format";

/**
 * «تراکنش‌ها» | «سوابق گذشته» — the two halves of the user's money story.
 * Transactions move balances; past records are the story from before the
 * first one and move nothing. One switch on both pages keeps that line visible.
 */
export default function TxScopeSwitch({ active, historyCount }: { active: "live" | "history"; historyCount?: number }) {
  return (
    <nav className="tx-scope" aria-label="بازه تراکنش‌ها">
      <Link href="/transactions" className="tx-scope-tab" data-tone="live" aria-current={active === "live" ? "page" : undefined}>
        <span className="tx-scope-dot" aria-hidden="true" />
        تراکنش‌ها
      </Link>
      <Link href="/transactions/history" className="tx-scope-tab" data-tone="history" aria-current={active === "history" ? "page" : undefined}>
        <Icon name="clock" size={14} />
        سوابق گذشته
        {historyCount ? <span className="tx-scope-count num">{faCount(historyCount)}</span> : null}
      </Link>
    </nav>
  );
}
