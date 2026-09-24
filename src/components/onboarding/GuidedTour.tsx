"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { markTourSeenAction } from "@/app/actions/tour";
import Icon from "@/components/ui/Icon";

export type TourStep = { target: string; title: string; body: string };

type Rect = { top: number; left: number; width: number; height: number };

/** The on-screen element of a step: phone and desktop mark different ones with the same name. */
function findTarget(name: string): HTMLElement | null {
  for (const el of document.querySelectorAll<HTMLElement>(`[data-tour="${name}"]`)) {
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== "hidden") return el;
  }
  return null;
}

/**
 * A short first-run tour: a spotlight on one control and a card beside it.
 * Shown once per account (the server remembers), skippable at every step,
 * Esc closes it, and a step whose control is not on this layout is skipped.
 */
export default function GuidedTour({ steps }: { steps: TourStep[] }) {
  const [open, setOpen] = useState(true);
  const [index, setIndex] = useState(0);
  const [rect, setRect] = useState<Rect | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const titleId = useId();

  const visible = steps.filter((s) => typeof document === "undefined" || !!findTarget(s.target));
  const step = visible[index];

  const finish = useCallback(() => {
    setOpen(false);
    void markTourSeenAction();
  }, []);

  // Measure after layout (and whenever the page moves under the spotlight).
  useEffect(() => {
    if (!open || !step) return;
    let frame = 0;
    const measure = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const el = findTarget(step.target);
        if (!el) return;
        const r = el.getBoundingClientRect();
        setRect({ top: r.top, left: r.left, width: r.width, height: r.height });
      });
    };
    measure();
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [open, step]);

  useEffect(() => {
    if (!open) return;
    cardRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") finish();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, index, finish]);

  if (!open || !step || !rect) return null;

  const pad = 6;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const width = Math.min(340, vw - 32);
  const center = rect.left + rect.width / 2;
  const left = Math.max(16, Math.min(center - width / 2, vw - width - 16));
  // Above the control when it sits in the lower half (the bottom tab bar), else below.
  const above = rect.top > vh / 2;
  const last = index === visible.length - 1;

  return (
    <div className="tour-root" role="dialog" aria-modal="true" aria-labelledby={titleId}>
      <div
        className="tour-spotlight"
        style={{ top: rect.top - pad, left: rect.left - pad, width: rect.width + pad * 2, height: rect.height + pad * 2 }}
        aria-hidden="true"
      />
      <div
        ref={cardRef}
        tabIndex={-1}
        className="tour-card"
        style={{ width, left, ...(above ? { bottom: vh - rect.top + pad + 12 } : { top: rect.top + rect.height + pad + 12 }) }}
      >
        <div className="flex items-start justify-between gap-2">
          <h2 id={titleId} className="text-[length:var(--fs-sm)] font-bold leading-6">
            {step.title}
          </h2>
          <button type="button" className="tour-close" onClick={finish} aria-label="بستن راهنما">
            <Icon name="x" size={16} />
          </button>
        </div>
        <p className="muted mt-1 text-[length:var(--fs-sm)] leading-6">{step.body}</p>
        <div className="mt-3 flex items-center justify-between gap-3">
          <span className="tour-dots" aria-hidden="true">
            {visible.map((s, i) => (
              <span key={s.target} className={i === index ? "is-current" : undefined} />
            ))}
          </span>
          <span className="sr-only" aria-live="polite">
            مرحله {(index + 1).toLocaleString("fa-IR")} از {visible.length.toLocaleString("fa-IR")}
          </span>
          <button
            type="button"
            className="btn btn-primary !min-h-9 !px-4 text-[length:var(--fs-xs)]"
            onClick={() => (last ? finish() : setIndex((i) => i + 1))}
          >
            {last ? "متوجه شدم" : "بعدی"}
          </button>
        </div>
      </div>
    </div>
  );
}
