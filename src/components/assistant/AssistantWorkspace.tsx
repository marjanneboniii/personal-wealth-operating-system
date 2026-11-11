"use client";

import { useEffect, useState, type ReactNode } from "react";
import Icon from "@/components/ui/Icon";

type Tab = "dashboard" | "chat" | "cash_loop";

/** Three views of one page — dashboard, chat, and cash loop planner — kept mounted so state survives a tab switch. */
export default function AssistantWorkspace({
  dashboard,
  chat,
  cashLoop,
  initialTab = "dashboard",
}: {
  dashboard: ReactNode;
  chat: ReactNode;
  cashLoop?: ReactNode;
  initialTab?: Tab;
}) {
  const [tab, setTab] = useState<Tab>(initialTab);

  useEffect(() => {
    const onAsk = () => setTab("chat");
    const onOpenLoop = () => setTab("cash_loop");
    window.addEventListener("assistant:ask", onAsk);
    window.addEventListener("assistant:open-loop", onOpenLoop);
    return () => {
      window.removeEventListener("assistant:ask", onAsk);
      window.removeEventListener("assistant:open-loop", onOpenLoop);
    };
  }, []);

  useEffect(() => {
    const url = new URL(window.location.href);
    if (tab === "chat") url.searchParams.set("tab", "chat");
    else if (tab === "cash_loop") url.searchParams.set("tab", "cash_loop");
    else url.searchParams.delete("tab");
    window.history.replaceState(null, "", url);
  }, [tab]);

  return (
    <div>
      <div className="ai-tabs" role="tablist" aria-label="دستیار هوشمند">
        <button
          type="button"
          role="tab"
          aria-selected={tab === "dashboard"}
          className={tab === "dashboard" ? "is-on" : undefined}
          onClick={() => setTab("dashboard")}
        >
          <Icon name="overview" size={15} /> داشبورد دستیار
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "chat"}
          className={tab === "chat" ? "is-on" : undefined}
          onClick={() => setTab("chat")}
        >
          <Icon name="sparkle" size={15} /> گفتگو با دستیار
        </button>
        {cashLoop && (
          <button
            type="button"
            role="tab"
            aria-selected={tab === "cash_loop"}
            className={tab === "cash_loop" ? "is-on" : undefined}
            onClick={() => setTab("cash_loop")}
          >
            <Icon name="swap" size={15} /> لوپ نقدینگی و تبدیل تتر
          </button>
        )}
      </div>
      <div role="tabpanel" hidden={tab !== "dashboard"}>
        {dashboard}
      </div>
      <div role="tabpanel" hidden={tab !== "chat"}>
        {chat}
      </div>
      {cashLoop && (
        <div role="tabpanel" hidden={tab !== "cash_loop"}>
          {cashLoop}
        </div>
      )}
    </div>
  );
}

/** Hands a question to the chat (and switches to it). */
export function AskButton({ question, label = "از دستیار بپرس", className }: { question: string; label?: string; className?: string }) {
  return (
    <button
      type="button"
      className={className ?? "btn btn-soft !min-h-8 shrink-0 !px-3 !py-1 text-[length:var(--fs-xs)]"}
      onClick={() => window.dispatchEvent(new CustomEvent("assistant:ask", { detail: question }))}
    >
      <Icon name="sparkle" size={13} /> {label}
    </button>
  );
}
