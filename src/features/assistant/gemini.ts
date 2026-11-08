import { ApiError, GoogleGenAI } from "@google/genai";

/**
 * The ONE place the Gemini API is reached from. Server-only: the key is read
 * from the environment on the server and never serialised to a client bundle,
 * a response body or a log line.
 *
 *   GEMINI_API_KEY    required — set in the host's environment (Vercel → Settings
 *                     → Environment Variables). Never committed.
 *   GEMINI_MODELS     optional — comma-separated FALLBACK CHAIN, strongest first.
 *                     Default: DEFAULT_GEMINI_MODELS below.
 *   GEMINI_MODEL      optional — legacy single model; when set (and GEMINI_MODELS
 *                     is not), it is tried first, then the default chain.
 *   GEMINI_ATTEMPT_TIMEOUT_MS optional — how long one model may stay silent
 *                     before the next model is tried (default 30 s, max 50 s:
 *                     the whole turn must fit Vercel's 60 s function limit).
 */

/**
 * Strongest Flash first. `gemini-3.7-flash` is deliberately absent: Google
 * routes it to 3.8 since 2026-10-08, so it would fail exactly when 3.8 does.
 * `gemini-flash-latest` is Google's moving alias; 2.5 is the last resort.
 * A model that no longer exists answers 404 and is skipped automatically.
 */
export const DEFAULT_GEMINI_MODELS = [
  "gemini-3.8-flash",
  "gemini-3.5-flash-lite",
  "gemini-3.1-flash-lite",
  "gemini-3.6-flash",
  "gemini-flash-latest",
  "gemini-2.5-flash",
  "gemini-2.0-flash",
] as const;
export const DEFAULT_GEMINI_MODEL = DEFAULT_GEMINI_MODELS[0];
const MODEL_ID = /^[a-z0-9][a-z0-9.\-]{1,80}$/i;

export type AssistantConfig = {
  configured: boolean;
  /** The first model of the chain (display / cache key). */
  model: string;
  /** Fallback chain, tried in order. */
  models: string[];
  /** Silence allowed per model attempt before falling back. */
  attemptTimeoutMs: number;
};

export function getAssistantConfig(env: NodeJS.ProcessEnv = process.env): AssistantConfig {
  const listed = (env.GEMINI_MODELS ?? "").split(",").map((m) => m.trim()).filter((m) => MODEL_ID.test(m));
  const single = env.GEMINI_MODEL?.trim();
  const chain = listed.length ? listed : [...(single && MODEL_ID.test(single) ? [single] : []), ...DEFAULT_GEMINI_MODELS];
  const models = [...new Set(chain)].slice(0, 8);
  const timeout = Number(env.GEMINI_ATTEMPT_TIMEOUT_MS);
  return {
    configured: Boolean(env.GEMINI_API_KEY?.trim()),
    model: models[0],
    models,
    attemptTimeoutMs: Number.isFinite(timeout) && timeout >= 10_000 && timeout <= 50_000 ? timeout : 30_000,
  };
}

/**
 * Models that answered «not found» are skipped for an hour, so a retired id
 * costs one failed call per instance per hour instead of one per message.
 */
const unavailableUntil = new Map<string, number>();
export function markModelUnavailable(model: string, ms = 3_600_000) {
  unavailableUntil.set(model, Date.now() + ms);
}
export function usableModels(models: string[]): string[] {
  const now = Date.now();
  const ok = models.filter((m) => (unavailableUntil.get(m) ?? 0) <= now);
  return ok.length ? ok : models;
}

export type AssistantErrorCode =
  | "not_configured"
  | "invalid_key"
  | "rate_limited"
  | "quota"
  | "unavailable"
  | "timeout"
  | "blocked"
  | "bad_model"
  | "region"
  | "unknown";

const MESSAGES: Record<AssistantErrorCode, string> = {
  not_configured:
    "گفتگو با دستیار فعلاً در دسترس نیست.",
  invalid_key: "دستیار فعلاً به سرویس هوش مصنوعی دسترسی ندارد. کمی بعد دوباره امتحان کنید.",
  rate_limited: "تعداد درخواست‌ها به Gemini بیش از حد مجاز شده است. یک دقیقه دیگر دوباره امتحان کنید.",
  quota: "سقف استفاده‌ی امروز از دستیار پر شده است. فردا دوباره امتحان کنید.",
  unavailable: "سرویس Gemini موقتاً در دسترس نیست. کمی بعد دوباره امتحان کنید.",
  timeout: "پاسخ Gemini بیش از حد طول کشید. سؤال را کوتاه‌تر کنید یا دوباره امتحان کنید.",
  blocked: "Gemini به این درخواست پاسخ نداد (فیلتر ایمنی). سؤال را به شکل دیگری بپرسید.",
  bad_model: "دستیار فعلاً در دسترس نیست. کمی بعد دوباره امتحان کنید.",
  region: "دستیار فعلاً در دسترس نیست. کمی بعد دوباره امتحان کنید.",
  unknown: "ارتباط با دستیار هوشمند ناموفق بود. دوباره امتحان کنید.",
};

export class AssistantError extends Error {
  constructor(
    public code: AssistantErrorCode,
    public status = 502,
  ) {
    super(MESSAGES[code]);
    this.name = "AssistantError";
  }
}

/** Maps any SDK / network failure to a user-facing code. Never echoes upstream text (it can contain the request). */
export function classifyGeminiError(err: unknown): AssistantError {
  if (err instanceof AssistantError) return err;
  const name = (err as { name?: string } | null)?.name;
  if (name === "AbortError" || name === "TimeoutError") return new AssistantError("timeout", 504);
  const message = String((err as { message?: string } | null)?.message ?? "");
  const status = err instanceof ApiError ? err.status : Number((err as { status?: number } | null)?.status) || 0;
  if (/location is not supported|user location/i.test(message)) return new AssistantError("region", 503);
  if (status === 400 && /api key|API_KEY/i.test(message)) return new AssistantError("invalid_key", 502);
  if (status === 401 || status === 403) return new AssistantError("invalid_key", 502);
  if (status === 404) return new AssistantError("bad_model", 502);
  if (status === 429) return new AssistantError(/quota|billing/i.test(message) && !/per minute|rate/i.test(message) ? "quota" : "rate_limited", 429);
  if (status === 500 || status === 502 || status === 503 || status === 504) return new AssistantError("unavailable", 503);
  if (/timed? ?out|ETIMEDOUT|deadline/i.test(message)) return new AssistantError("timeout", 504);
  if (/fetch failed|ECONNRESET|ENOTFOUND|EAI_AGAIN|network/i.test(message)) return new AssistantError("unavailable", 503);
  return new AssistantError("unknown", 502);
}

let cached: { key: string; client: GoogleGenAI } | null = null;
/** Test seam: a stand-in client (the suite never reaches the network). */
type ModelsLike = Pick<GoogleGenAI["models"], "generateContentStream" | "generateContent">;
let override: { models: ModelsLike } | null = null;
export function setGeminiClientForTests(client: { models: Partial<ModelsLike> } | null) {
  override = client as { models: ModelsLike } | null;
}

/** Lazily built client; throws `not_configured` when the key is missing. */
export function getGeminiClient(): GoogleGenAI {
  const key = process.env.GEMINI_API_KEY?.trim();
  if (!key) throw new AssistantError("not_configured", 503);
  if (override) return override as unknown as GoogleGenAI;
  if (cached?.key === key) return cached.client;
  const client = new GoogleGenAI({
    apiKey: key,
    httpOptions: {
      // A hard ceiling only; the per-model silence timer in chat.ts decides
      // when to move on to the next model.
      timeout: 58_000,
      // One quick retry of a transient failure; anything more is the next
      // model's job (a fallback answers sooner than a backoff).
      retryOptions: { attempts: 2, initialDelay: 1, maxDelay: 3, httpStatusCodes: [500, 502, 503, 504] },
    },
  });
  cached = { key, client };
  return client;
}

/**
 * Whether the NEXT model in the chain might succeed where this one failed.
 * Key, region and content problems are the same for every model: falling
 * back would only repeat them.
 */
export function shouldFallBack(e: AssistantError): boolean {
  return ["timeout", "unavailable", "rate_limited", "quota", "bad_model", "unknown"].includes(e.code);
}

/** Combines the caller's signal with a silence timer that `touch()` restarts on every chunk. */
export function attemptSignal(parent: AbortSignal | undefined, silenceMs: number) {
  const controller = new AbortController();
  let timedOut = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const touch = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      timedOut = true;
      controller.abort(new DOMException("model silent", "TimeoutError"));
    }, silenceMs);
  };
  const onParent = () => controller.abort(parent?.reason);
  if (parent?.aborted) controller.abort(parent.reason);
  else parent?.addEventListener("abort", onParent, { once: true });
  touch();
  return {
    signal: controller.signal,
    touch,
    timedOut: () => timedOut,
    done: () => {
      clearTimeout(timer);
      parent?.removeEventListener("abort", onParent);
    },
  };
}
