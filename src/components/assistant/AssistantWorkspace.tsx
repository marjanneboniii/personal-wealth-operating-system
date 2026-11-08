"use client";

import { useEffect, useState, type ReactNode } from "react";
import Icon from "@/components/ui/Icon";

type Tab = "dashboard" | "chat";

/** Two views of one page — the dashboard and the chat — kept mounted so a running answer survives a tab switch. */
export default function AssistantWorkspace({ dashboard, chat, initialTab = "dashboard" }: { dashboard: ReactNode; chat: ReactNode; initialTab?: Tab }) {
  const [tab, setTab] = useState<Tab>(initialTab);

  useEffect(() => {
    const onAsk = () => setTab("chat");
    window.addEventListener("assistant:ask", onAsk);
    return () => window.removeEventListener("assistant:ask", onAsk);
  }, []);

  useEffect(() => {
    const url = new URL(window.location.href);
    if (tab === "chat") url.searchParams.set("tab", "chat");
    else url.searchParams.delete("tab");
    window.history.replaceState(null, "", url);
  }, [tab]);

  return (
    <div>
      <div className="ai-tabs" role="tablist" aria-label="دستیار هوشمند">
        <button type="button" role="tab" aria-selected={tab === "dashboard"} className={tab === "dashboard" ? "is-on" : undefined} onClick={() => setTab("dashboard")}>
          <Icon name="overview" size={15} /> داشبورد دستیار
        </button>
        <button type="button" role="tab" aria-selected={tab === "chat"} className={tab === "chat" ? "is-on" : undefined} onClick={() => setTab("chat")}>
          <Icon name="sparkle" size={15} /> گفتگو با دستیار
        </button>
      </div>
      <div role="tabpanel" hidden={tab !== "dashboard"}>
        {dashboard}
      </div>
      <div role="tabpanel" hidden={tab !== "chat"}>
        {chat}
      </div>
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
