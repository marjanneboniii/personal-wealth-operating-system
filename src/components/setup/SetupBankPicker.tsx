"use client";

import { useId, useState } from "react";
import Image from "next/image";
import Icon from "@/components/ui/Icon";
import Sheet from "@/components/ui/Sheet";
import { faCount } from "@/lib/format";
import { SETUP_BANKS, searchSetupBanks, type SetupBankOption } from "@/features/setup/bankCatalog";

function BankLogo({ bank }: { bank: SetupBankOption }) {
  return <Image className="setup-bank-picker-logo" src={bank.logo} alt="" width={44} height={44} />;
}

export default function SetupBankPicker({ value, onSelect }: {
  value: string;
  onSelect: (bank: SetupBankOption) => void;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const selected = SETUP_BANKS.find((bank) => bank.value === value);
  const banks = searchSetupBanks(query);
  return <>
    <span className="label" id={`${id}-label`}>بانک یا مؤسسه</span>
    <button type="button" className="setup-bank-picker-trigger" aria-labelledby={`${id}-label ${id}-value`} aria-haspopup="dialog" aria-expanded={open} onClick={() => { setQuery(""); setOpen(true); }}>
      {selected ? <BankLogo bank={selected} /> : <span className="setup-bank-picker-placeholder"><Icon name="card" size={22} /></span>}
      <span className="setup-bank-picker-triggerText"><b id={`${id}-value`}>{selected?.name ?? "بانک خود را انتخاب کنید"}</b><small>{selected ? "برای تغییر بانک، لمس کنید" : "انتخاب از فهرست، همراه با لوگو"}</small></span>
      <Icon name="chevronDown" size={18} />
    </button>
    <Sheet open={open} onClose={() => setOpen(false)} title="انتخاب بانک یا مؤسسه" wide>
      <div className="setup-bank-picker-picker" dir="rtl">
        <div className="setup-bank-picker-searchArea">
          <p className="setup-bank-picker-intro">بانک خود را پیدا کنید و با یک لمس انتخاب کنید.</p>
          <label className="setup-bank-picker-search">
            <Icon name="search" size={19} />
            <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="جست‌وجوی بانک یا مؤسسه…" aria-label="جست‌وجوی بانک یا مؤسسه" />
          </label>
          <p className="setup-bank-picker-count" role="status">{faCount(banks.length)} بانک و مؤسسه</p>
        </div>
        <div className="setup-bank-picker-grid" role="group" aria-label="فهرست بانک‌ها و مؤسسات">
          {banks.map((bank) => <button key={bank.value} type="button" className="setup-bank-picker-option" aria-pressed={value === bank.value} onClick={() => { onSelect(bank); setOpen(false); }}>
            <BankLogo bank={bank} /><span>{bank.name}</span>
            {value === bank.value && <span className="setup-bank-picker-check"><Icon name="check" size={14} /></span>}
          </button>)}
        </div>
        {!banks.length && <div className="setup-bank-picker-empty"><Icon name="search" size={26} /><b>بانکی با این نام پیدا نشد</b><span>نام کوتاه‌تر را جست‌وجو کنید یا همهٔ بانک‌ها را ببینید.</span><button className="btn btn-ghost" type="button" onClick={() => setQuery("")}>نمایش همهٔ بانک‌ها</button></div>}
      </div>
    </Sheet>
  </>;
}
