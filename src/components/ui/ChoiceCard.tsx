"use client";
import type { ReactNode } from "react";
import Icon from "./Icon";

export default function ChoiceCard({ selected, title, detail, mark, onClick, disabled = false }: {
  selected: boolean; title: string; detail?: string; mark?: ReactNode; onClick: () => void; disabled?: boolean;
}) {
  return <button type="button" className="choice-card" data-selected={selected || undefined} aria-label={title} aria-pressed={selected} disabled={disabled} onClick={onClick}>
    {mark && <span className="choice-mark">{mark}</span>}
    <span className="choice-copy"><b>{title}</b>{detail && <small>{detail}</small>}</span>
    <span className="choice-indicator" aria-hidden="true">{selected && <Icon name="check" size={13} />}</span>
  </button>;
}
