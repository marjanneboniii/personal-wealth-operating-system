import Link from "next/link";
import Icon from "@/components/ui/Icon";
import { faCount } from "@/lib/format";

/**
 * «در توازن» | «پیش از توازن» — the two halves of the user's money story.
 * Live transactions move balances; history records are the story before the
 * app and move nothing. One switch on both pages keeps that line visible.
 */
export default function TxScopeSwitch({ active, historyCount }: { active: "live" | "history"; historyCount?: number }) {
  return (
    <nav className="tx-scope" aria-label="بازه تراکنش‌ها">
      <Link href="/transactions" className="tx-scope-tab" data-tone="live" aria-current={active === "live" ? "page" : undefined}>
        <span className="tx-scope-dot" aria-hidden="true" />
        در توازن
      </Link>
      <Link href="/transactions/history" className="tx-scope-tab" data-tone="history" aria-current={active === "history" ? "page" : undefined}>
        <Icon name="clock" size={14} />
        پیش از توازن
        {historyCount ? <span className="tx-scope-count num">{faCount(historyCount)}</span> : null}
      </Link>
    </nav>
  );
}
