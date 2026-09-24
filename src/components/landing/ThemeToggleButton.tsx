"use client";

import { useSyncExternalStore } from "react";
import Icon from "@/components/ui/Icon";
import { setThemeMode } from "@/lib/displayPrefs";

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
      aria-pressed={dark}
      className="icon-btn !min-h-12 !min-w-12"
      // An explicit choice outranks the OS preference and survives reloads;
      // the pre-paint script in the root layout replays it before first paint.
      onClick={() => setThemeMode(dark ? "light" : "dark")}
    >
      <Icon name={dark ? "sun" : "moon"} size={18} />
    </button>
  );
}
