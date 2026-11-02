"use client";
import Icon from "@/components/ui/Icon";

/**
 * «دانلود PDF» — opens the browser's print sheet, where «Save as PDF» writes
 * the file. The page title (the month) becomes the file name, and the print
 * stylesheet keeps only the report sheet.
 */
export default function ReportPrint() {
  return (
    <button type="button" className="btn btn-primary" onClick={() => window.print()}>
      <Icon name="download" size={16} />
      دانلود PDF
    </button>
  );
}
