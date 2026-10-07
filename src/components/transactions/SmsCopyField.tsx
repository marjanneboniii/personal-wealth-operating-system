"use client";
import { useRef, useState } from "react";

export default function SmsCopyField({ label, value, secret = false }: { label: string; value: string; secret?: boolean }) {
  const ref = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState("");
  async function copy() {
    try { await navigator.clipboard.writeText(value); setStatus("کپی شد"); }
    catch { ref.current?.focus(); ref.current?.select(); setStatus("متن انتخاب شد؛ گزینهٔ Copy آیفون را بزنید."); }
  }
  return <div className="sms-copy-field">
    <label><span className="label">{label}</span><input ref={ref} className="field" dir="ltr" readOnly value={value} autoComplete="off" spellCheck={false} type={secret ? "password" : "text"} onFocus={(event) => event.target.select()} /></label>
    <button type="button" className="btn btn-ghost" onClick={copy}>کپی</button>
    {status && <p role="status" className="muted text-xs">{status}</p>}
  </div>;
}
