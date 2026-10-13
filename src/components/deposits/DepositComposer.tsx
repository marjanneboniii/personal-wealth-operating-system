"use client";

import { useCallback, useEffect, useState } from "react";
import Icon from "@/components/ui/Icon";
import Sheet from "@/components/ui/Sheet";
import DepositForm, { type DepositAccountOption } from "@/components/deposits/DepositForm";

/**
 * «ثبت سپرده» as a button that opens the form in a sheet — a bottom sheet on
 * a phone, a dialog on a wide screen — instead of a long form open on the page.
 * `#new` in the address (older links, the header button) opens it too.
 */
export default function DepositComposer({
  accounts,
  balances,
  today,
  className = "btn btn-primary",
  label = "ثبت سپرده",
  listenToHash = false,
}: {
  accounts: DepositAccountOption[];
  balances?: Record<string, string>;
  today: string;
  className?: string;
  label?: string;
  /** Only one composer per page should answer `#new`. */
  listenToHash?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => {
    setOpen(false);
    if (window.location.hash === "#new") history.replaceState(null, "", window.location.pathname + window.location.search);
  }, []);

  useEffect(() => {
    if (!listenToHash) return;
    const sync = () => {
      if (window.location.hash === "#new") setOpen(true);
    };
    sync();
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, [listenToHash]);

  return (
    <>
      <button type="button" className={className} onClick={() => setOpen(true)}>
        <Icon name="plus" size={16} />
        {label}
      </button>
      <Sheet open={open} onClose={close} title="ثبت سپرده">
        <div className="p-4">
          <DepositForm accounts={accounts} balances={balances} today={today} onSaved={close} />
        </div>
      </Sheet>
    </>
  );
}
