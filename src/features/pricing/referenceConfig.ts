/**
 * Which reference-price sources are switched on, how often each may be asked,
 * and how much of a quota the app allows itself — from the environment,
 * SERVER-SIDE ONLY.
 *
 * Nothing here is `NEXT_PUBLIC_`, and the BrsAPI key is read at the moment a
 * provider is built, never exported as data a component could serialise.
 *
 * DEFAULTS ARE THE CAUTIOUS ONES
 *   • Gold API: on. Keyless, commercial use permitted, no limit on real-time
 *     prices — verified 2026-09-24. Asked at most once a minute.
 *   • BrsAPI: on as soon as `BRSAPI_KEY` is set. Its terms forbid the free
 *     tier on «Google Sheets, Cloudflare Workers and similar»; BrsAPI support
 *     confirmed on 2026-09-24 that this app's use on Vercel is allowed (see
 *     docs/MARKET_DATA_SOURCES.md). `BRSAPI_ENABLED=false` switches it off.
 *   • BrsAPI interval: 5 minutes per feed. Support confirmed the daily quota
 *     is SHARED by all routes: three feeds × 288 = 864 requests a day, under
 *     the 1,500 allowance, and the budget below stops well before that.
 */
import { BRS_FEEDS, type BrsFeed } from "./providers/brsapi";

export type ReferenceSourceId = "gold-api" | `brsapi:${BrsFeed}`;

export type ReferenceConfig = {
  goldApi: { enabled: boolean; intervalMs: number };
  brsapi: {
    /** Off only when the operator says so; the host was confirmed allowed. */
    enabled: boolean;
    /** True when a key is present. The key itself is not part of this object. */
    hasKey: boolean;
    feeds: readonly BrsFeed[];
    intervalMs: number;
    /** Requests per Tehran day, ALL BrsAPI feeds together — the quota is shared. */
    dailyBudget: number;
  };
};

function int(raw: string | undefined, fallback: number, min: number, max: number): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

function flag(raw: string | undefined, fallback: boolean): boolean {
  if (raw === undefined || raw.trim() === "") return fallback;
  return /^(1|true|yes|on)$/i.test(raw.trim());
}

type Env = Readonly<Record<string, string | undefined>>;

export function readReferenceConfig(env: Env = process.env): ReferenceConfig {
  const feeds = (env.BRSAPI_FEEDS ?? BRS_FEEDS.join(","))
    .split(",")
    .map((f) => f.trim())
    .filter((f): f is BrsFeed => (BRS_FEEDS as readonly string[]).includes(f));
  return {
    goldApi: {
      enabled: flag(env.GOLD_API_ENABLED, true),
      intervalMs: int(env.GOLD_API_REFRESH_SECONDS, 60, 30, 3600) * 1000,
    },
    brsapi: {
      enabled: flag(env.BRSAPI_ENABLED, true),
      hasKey: Boolean(env.BRSAPI_KEY && env.BRSAPI_KEY.trim()),
      feeds,
      // Never faster than once a minute per feed, whatever is configured.
      intervalMs: int(env.BRSAPI_REFRESH_SECONDS, 300, 60, 86_400) * 1000,
      dailyBudget: int(env.BRSAPI_DAILY_REQUEST_BUDGET, 1200, 1, 1500),
    },
  };
}

/** The BrsAPI key, for the one place that builds the provider. */
export function brsApiKey(env: Env = process.env): string {
  return (env.BRSAPI_KEY ?? "").trim();
}

/** Why a source is not being asked, in Persian, for the status panel. */
export function disabledReason(source: ReferenceSourceId, config: ReferenceConfig): string | null {
  if (source === "gold-api") return config.goldApi.enabled ? null : "با GOLD_API_ENABLED خاموش شده است.";
  const feed = source.slice("brsapi:".length) as BrsFeed;
  if (!config.brsapi.enabled) return "با BRSAPI_ENABLED خاموش شده است.";
  if (!config.brsapi.hasKey) return "کلید BRSAPI_KEY تنظیم نشده است.";
  if (!config.brsapi.feeds.includes(feed)) return "این بخش در BRSAPI_FEEDS نیست.";
  return null;
}

export const REFERENCE_SOURCES: readonly ReferenceSourceId[] = [
  "gold-api",
  ...BRS_FEEDS.map((f) => `brsapi:${f}` as const),
];
