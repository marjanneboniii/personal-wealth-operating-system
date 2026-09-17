"use client";
import Icon from "@/components/ui/Icon";

export default function SmsChoices({ label, value, options, onChange }: {
 label: string; value: string; options: { id: string; name: string; hint?: string }[]; onChange: (id: string) => void;
}) {
 return <div className="space-y-2"><p className="label">{label}</p><div className="expense-squares" role="group" aria-label={label}>
  {options.map((option) => <button key={option.id} type="button" className="expense-square" data-on={value === option.id || undefined} aria-pressed={value === option.id} onClick={() => onChange(option.id)}>
   {value === option.id && <span className="expense-check" aria-hidden="true"><Icon name="check" size={11} strokeWidth={3} /></span>}
   <span className="expense-square-label">{option.name}</span>{option.hint && <span className="expense-square-meta">{option.hint}</span>}
  </button>)}
 </div></div>;
}
