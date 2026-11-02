"use client";
import { useState } from "react";
import Icon from "@/components/ui/Icon";

/** The sheet is laid out at A4 width (210mm at 96dpi) whatever the screen. */
const SHEET_PX = 794;
const PAGE_MM = { w: 210, h: 297, x: 11, y: 12 };
/** iOS Safari refuses canvases above ~16.7M pixels; stay under it. */
const MAX_CANVAS_PIXELS = 16_000_000;
/** A page may end only where one of these begins — never through a line of text. */
const BREAK_BEFORE = ".mrep > *, .mrep-section > *, .mrep-cols > *, .mrep-shares > li, .mrep-top > li, .mrep-table tr, .mrep-foot > p";

/** Greedy page cuts at the last allowed break that fits; a block taller than a page is cut where it must be. */
function pageCuts(height: number, pageHeight: number, breaks: number[]): number[] {
  const cuts = [0];
  let start = 0;
  while (start + pageHeight < height) {
    const fits = breaks.filter((y) => y > start + 1 && y <= start + pageHeight);
    start = fits.length ? Math.max(...fits) : start + pageHeight;
    cuts.push(start);
  }
  cuts.push(height);
  return cuts;
}

/**
 * «دانلود PDF» — writes the report as a PDF file and downloads it, no print
 * sheet. A copy of the sheet is laid out off-screen at A4 width, drawn to an
 * image (html-to-image renders through the browser itself, so Persian
 * shaping and the app's fonts come out exactly as on screen) and cut into
 * A4 pages between rows. Both libraries load on the first tap only. If the
 * browser cannot draw it, the print sheet opens instead, where «Save as PDF»
 * still works.
 */
export default function ReportPrint({ targetId, fileName }: { targetId: string; fileName: string }) {
  const [busy, setBusy] = useState(false);

  async function download() {
    const sheet = document.getElementById(targetId);
    if (!sheet || busy) return;
    setBusy(true);
    const frame = document.createElement("div");
    try {
      const [{ toCanvas }, { jsPDF }] = await Promise.all([import("html-to-image"), import("jspdf")]);
      await document.fonts.ready;

      frame.className = "mrep-capture";
      const copy = sheet.cloneNode(true) as HTMLElement;
      copy.removeAttribute("id");
      copy.dataset.capture = "";
      frame.appendChild(copy);
      sheet.parentElement!.appendChild(frame);

      const top = copy.getBoundingClientRect().top;
      const height = Math.ceil(copy.scrollHeight);
      const breaks = [...copy.querySelectorAll<HTMLElement>(BREAK_BEFORE)].map((el) => Math.floor(el.getBoundingClientRect().top - top));
      const contentW = PAGE_MM.w - 2 * PAGE_MM.x;
      const pagePx = Math.floor(((PAGE_MM.h - 2 * PAGE_MM.y) / contentW) * SHEET_PX);
      const cuts = pageCuts(height, pagePx, breaks);

      const ratio = Math.min(2, Math.sqrt(MAX_CANVAS_PIXELS / (SHEET_PX * height)));
      const options = { width: SHEET_PX, height, backgroundColor: "#ffffff" };
      // Safari draws web fonts only from the second render on: a cheap first pass loads them.
      await toCanvas(copy, { ...options, pixelRatio: 0.1 });
      const canvas = await toCanvas(copy, { ...options, pixelRatio: ratio });

      const pdf = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait", compress: true });
      const scale = canvas.width / SHEET_PX;
      for (let i = 0; i < cuts.length - 1; i++) {
        const sliceH = cuts[i + 1] - cuts[i];
        const page = document.createElement("canvas");
        page.width = canvas.width;
        page.height = Math.ceil(sliceH * scale);
        const ctx = page.getContext("2d")!;
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, page.width, page.height);
        ctx.drawImage(canvas, 0, Math.floor(cuts[i] * scale), canvas.width, page.height, 0, 0, page.width, page.height);
        if (i > 0) pdf.addPage();
        pdf.addImage(page.toDataURL("image/jpeg", 0.92), "JPEG", PAGE_MM.x, PAGE_MM.y, contentW, (sliceH / SHEET_PX) * contentW);
      }
      pdf.save(`${fileName}.pdf`);
    } catch {
      window.print();
    } finally {
      frame.remove();
      setBusy(false);
    }
  }

  return (
    <button type="button" className="btn btn-primary" onClick={download} disabled={busy} aria-busy={busy}>
      <Icon name={busy ? "clock" : "download"} size={16} />
      {busy ? "در حال ساخت PDF…" : "دانلود PDF"}
    </button>
  );
}
