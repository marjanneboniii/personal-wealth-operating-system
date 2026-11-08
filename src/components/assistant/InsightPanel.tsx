"use client";

import { useState } from "react";
import Icon from "@/components/ui/Icon";
import Markdown from "./Markdown";
import { generateInsightAction } from "@/app/actions/assistant";

/**
 * «تحلیل هوشمند» — the model's written reading of the dashboard. Never
 * generated on page load (cost): the last stored analysis is shown, marked
 * stale when the data has changed since, and a new one is made on request.
 * The server answers from its cache when the data is unchanged.
 */
export default function InsightPanel({
  configured,
  initial,
  stale,
}: {
  configured: boolean;
  initial: { content: string; createdAt: string } | null;
  stale: boolean;
}) {
  const [insight, setInsight] = useState(initial);
  const [isStale, setStale] = useState(stale);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (force: boolean) => {
    setBusy(true);
    setError(null);
    const res = await generateInsightAction(force);
    setBusy(false);
    if (res.ok) {
      setInsight({ content: res.data.content, createdAt: res.data.createdAt });
      setStale(false);
    } else setError(res.message);
  };

  return (
    <div className="card ai-insight">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="ai-empty-icon !h-8 !w-8" aria-hidden="true">
            <Icon name="sparkle" size={16} />
          </span>
          <div>
            <b className="block text-[length:var(--fs-sm)]">تحلیل هوشمند وضعیت مالی</b>
            {insight && (
              <span className="muted text-[length:var(--fs-micro)]">
                {new Date(insight.createdAt).toLocaleString("fa-IR", { dateStyle: "medium", timeStyle: "short" })}
                {isStale ? " · داده‌ها از آن زمان تغییر کرده‌اند" : ""}
              </span>
            )}
          </div>
        </div>
        {configured && (
          <button type="button" className="btn btn-soft !min-h-9 !px-3 text-[length:var(--fs-xs)]" disabled={busy} onClick={() => run(Boolean(insight) && !isStale)}>
            <Icon name="refresh" size={14} /> {busy ? "در حال تحلیل…" : insight ? (isStale ? "به‌روزرسانی تحلیل" : "تحلیل دوباره") : "تحلیل کن"}
          </button>
        )}
      </div>
      {error && (
        <p className="ai-error mt-3" role="alert">
          <Icon name="alert" size={14} /> {error}
        </p>
      )}
      {insight ? (
        <div className={`mt-3 ${isStale ? "opacity-70" : ""}`}>
          <Markdown text={insight.content} />
        </div>
      ) : (
        !error && (
          <p className="muted mt-3 text-[length:var(--fs-xs)] leading-5">
            {configured
              ? "دستیار داده‌های همین صفحه را می‌خواند و مهم‌ترین مشکلات و فرصت‌ها را به زبان ساده توضیح می‌دهد. تا داده‌ها تغییر نکنند، تحلیل دوباره هزینه‌ای ندارد."
              : "تحلیل هوشمند فعلاً در دسترس نیست. اعداد و هشدارهای این صفحه به‌روز هستند."}
          </p>
        )
      )}
    </div>
  );
}
