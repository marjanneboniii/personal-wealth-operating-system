"use client";
import { useState } from "react";
import Icon from "@/components/ui/Icon";

/** The tracking code with a copy button that says «کپی شد» (also to screen readers). */
export function ReceiptCode({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  }
  return (
    <span className="receipt-code">
      <bdi className="num" dir="ltr">
        {label}
      </bdi>
      <button type="button" className="receipt-copy" onClick={copy} aria-label={copied ? "کپی شد" : "کپی کد پیگیری"}>
        <Icon name={copied ? "check" : "copy"} size={15} />
      </button>
      <span role="status" className="sr-only">
        {copied ? "کپی شد" : ""}
      </span>
    </span>
  );
}

/** «چاپ / ذخیره PDF» — the print stylesheet keeps only the receipt card. */
export function ReceiptPrint() {
  return (
    <button type="button" className="btn btn-soft" onClick={() => window.print()}>
      <Icon name="download" size={16} />
      چاپ / PDF
    </button>
  );
}
