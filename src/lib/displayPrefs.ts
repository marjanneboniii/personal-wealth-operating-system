/**
 * Display preferences of THIS device: theme and privacy mode.
 *
 * Deliberately device-local (localStorage), not per account: hiding amounts is
 * about who can see this screen right now, and an installed PWA on a phone
 * keeps its own storage apart from the browser. Every access is guarded — a
 * private window or blocked storage simply falls back to the defaults.
 *
 * The same keys are read by the inline boot script in `app/layout.tsx`, so the
 * page is painted in the right theme with amounts already hidden — no flash.
 */
export const THEME_KEY = "pwos-theme";
export const PRIVACY_KEY = "pwos-privacy";
export const DISPLAY_EVENT = "pwos-display-change";

export type ThemeMode = "light" | "dark" | "system";

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* storage unavailable — the choice lasts for this page only */
  }
}

export function readThemeMode(): ThemeMode {
  const t = read(THEME_KEY);
  return t === "light" || t === "dark" ? t : "system";
}

function systemDark(): boolean {
  try {
    return window.matchMedia("(prefers-color-scheme: dark)").matches;
  } catch {
    return false;
  }
}

/** Paint the theme the mode resolves to right now. */
export function paintTheme(mode: ThemeMode = readThemeMode()) {
  document.documentElement.classList.toggle("dark", mode === "dark" || (mode === "system" && systemDark()));
}

export function setThemeMode(mode: ThemeMode) {
  write(THEME_KEY, mode);
  paintTheme(mode);
  window.dispatchEvent(new CustomEvent(DISPLAY_EVENT));
}

export function readPrivacy(): boolean {
  return read(PRIVACY_KEY) === "on";
}

export function setPrivacy(on: boolean) {
  write(PRIVACY_KEY, on ? "on" : "off");
  document.documentElement.toggleAttribute("data-privacy", on);
  window.dispatchEvent(new CustomEvent(DISPLAY_EVENT));
}

export function subscribeDisplay(cb: () => void) {
  window.addEventListener(DISPLAY_EVENT, cb);
  window.addEventListener("storage", cb);
  return () => {
    window.removeEventListener(DISPLAY_EVENT, cb);
    window.removeEventListener("storage", cb);
  };
}

/** The inline boot script: theme and privacy before first paint. Kept in sync with the functions above. */
export const DISPLAY_BOOT_SCRIPT = `(function(){try{var t=localStorage.getItem('${THEME_KEY}');if(t!=='light'&&t!=='dark')t='system';var d=t==='dark'||(t==='system'&&window.matchMedia('(prefers-color-scheme: dark)').matches);document.documentElement.classList.toggle('dark',d);if(localStorage.getItem('${PRIVACY_KEY}')==='on')document.documentElement.setAttribute('data-privacy','');}catch(e){}})();`;
