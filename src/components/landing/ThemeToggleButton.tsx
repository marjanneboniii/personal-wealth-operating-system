"use client";

import { useSyncExternalStore } from "react";
import Icon from "@/components/ui/Icon";

function subscribeTheme(cb: () => void) {
  const obs = new MutationObserver(cb);
  obs.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
  return () => obs.disconnect();
}

export default function ThemeToggleButton() {
  const dark = useSyncExternalStore(
    subscribeTheme,
    () => document.documentElement.classList.contains("dark"),
    () => false,
  );
  return (
    <button
      type="button"
      aria-label="تغییر حالت روشن و تاریک"
      className="icon-btn !min-h-12 !min-w-12"
      onClick={() => {
        const next = !dark;
        document.documentElement.classList.toggle("dark", next);
        localStorage.setItem("pwos-theme", next ? "dark" : "light");
      }}
    >
      <Icon name={dark ? "sun" : "moon"} size={18} />
    </button>
  );
}
