"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

/** Only one row is open at a time: opening one closes the last. */
let closeOpenRow: (() => void) | null = null;

/** Below this the finger is still deciding between a scroll and a swipe. */
const SLOP = 10;

/**
 * A list row whose quick actions slide out from under it on a touch screen.
 *
 * The finger drags the row toward the reading start (right, in RTL) and the
 * actions appear behind it on the trailing side — the RTL mirror of the iOS
 * list gesture. Vertical movement is left to the browser (`touch-action:
 * pan-y`), so the list still scrolls normally.
 *
 * It is a shortcut only: every action here is also in the row's expanded
 * detail, which is what a mouse or keyboard user reaches. While closed the
 * actions are inert, so they are never tabbed to while hidden.
 */
export default function SwipeRow({ actions, children }: { actions: ReactNode; children: ReactNode }) {
  const rowRef = useRef<HTMLDivElement>(null);
  const actionsRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; base: number; horizontal: boolean | null } | null>(null);
  const suppressClick = useRef(false);
  const [offset, setOffset] = useState(0);
  const [open, setOpen] = useState(false);
  const [dragging, setDragging] = useState(false);

  const width = () => actionsRef.current?.offsetWidth ?? 0;

  useEffect(() => {
    if (!open) return;
    const close = () => {
      setOpen(false);
      setOffset(0);
    };
    closeOpenRow?.();
    closeOpenRow = close;
    return () => {
      if (closeOpenRow === close) closeOpenRow = null;
    };
  }, [open]);

  useEffect(() => {
    const actionsEl = actionsRef.current;
    if (actionsEl) actionsEl.inert = !open;
  }, [open]);

  return (
    <div className="mny-swipe" data-open={open || undefined}>
      <div ref={actionsRef} className="mny-swipe-actions" onClick={() => { setOpen(false); setOffset(0); }}>
        {actions}
      </div>
      <div
        ref={rowRef}
        className="mny-swipe-face"
        style={{ transform: offset ? `translateX(${offset}px)` : undefined, transition: dragging ? "none" : undefined }}
        onPointerDown={(e) => {
          if (e.pointerType !== "touch") return;
          drag.current = { x: e.clientX, y: e.clientY, base: offset, horizontal: null };
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (!d) return;
          const dx = e.clientX - d.x;
          const dy = e.clientY - d.y;
          if (d.horizontal === null) {
            if (Math.abs(dx) < SLOP && Math.abs(dy) < SLOP) return;
            d.horizontal = Math.abs(dx) > Math.abs(dy);
            if (d.horizontal) {
              setDragging(true);
              rowRef.current?.setPointerCapture(e.pointerId);
            }
          }
          if (!d.horizontal) return;
          setOffset(Math.max(0, Math.min(width(), d.base + dx)));
        }}
        onPointerUp={() => {
          const d = drag.current;
          drag.current = null;
          if (!d?.horizontal) return;
          setDragging(false);
          suppressClick.current = true;
          const shouldOpen = offset > width() / 2;
          setOpen(shouldOpen);
          setOffset(shouldOpen ? width() : 0);
        }}
        onPointerCancel={() => {
          drag.current = null;
          setDragging(false);
          setOffset(open ? width() : 0);
        }}
        onClickCapture={(e) => {
          // The tap that ends a swipe, or a tap on an open row, only closes it.
          if (suppressClick.current || open) {
            e.preventDefault();
            e.stopPropagation();
            suppressClick.current = false;
            if (open) {
              setOpen(false);
              setOffset(0);
            }
          }
        }}
      >
        {children}
      </div>
    </div>
  );
}
