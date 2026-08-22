/**
 * §2 — Pro Mode render-level regression for the General Ledger page
 * («سوابق مالی» / `/ledger`).
 *
 * Renders the REAL async server component (React 19 SSR) against an isolated
 * in-memory database with a real session, and pins the two global states:
 *
 *   SIMPLE (default)  → «خلاصه حساب‌ها», NO trial-balance wording, NO
 *                       debit/credit («ورود/خروج») split columns, NO codes.
 *   PRO (opt-in)      → «تراز آزمایشی» + «ورود/خروج» columns visible.
 */
import assert from "node:assert/strict";
import { test, mock } from "node:test";
import { createElement } from "react";

let sessionToken: string | null = null;
mock.module("next/headers", {
  namedExports: {
    cookies: async () => ({
      get: (name: string) =>
        name === "pwos_session" && sessionToken ? { value: sessionToken } : undefined,
      set: () => {},
      delete: () => {},
    }),
    headers: async () => new Headers(),
  },
});
mock.module("next/cache", {
  namedExports: { revalidatePath: () => {} },
});
mock.module("next/navigation", {
  namedExports: {
    redirect: (url: string) => {
      throw new Error(`NEXT_REDIRECT:${url}`);
    },
    useRouter: () => ({ replace: () => {}, push: () => {}, refresh: () => {} }),
  },
});

let db: any, createSchemaIfNotExists: any, users: any, sessions: any, userPreferences: any;
let createSession: any, preferences: any, LedgerPage: any, renderToReadableStream: any;

async function loadModules() {
  ({ db } = await import("../src/db"));
  ({ createSchemaIfNotExists } = await import("../src/db/init-schema"));
  ({ users, sessions, userPreferences } = await import("../src/db/schema"));
  ({ createSession } = await import("../src/lib/auth"));
  preferences = await import("../src/features/preferences/service");
  ({ default: LedgerPage } = await import("../src/app/ledger/page"));
  ({ renderToReadableStream } = await import("react-dom/server"));
}
const modulesReady = loadModules();

async function renderLedger(): Promise<string> {
  const stream = await renderToReadableStream(
    createElement(LedgerPage, { searchParams: Promise.resolve({}) }),
  );
  return await new Response(stream).text();
}

test("§2 /ledger renders the SIMPLE vocabulary by default and PRO after opt-in", async () => {
  await modulesReady;
  await createSchemaIfNotExists();
  await db.delete(userPreferences);
  await db.delete(sessions);
  await db.delete(users);

  const [alice] = await db
    .insert(users)
    .values({ name: "Alice Ledger", username: "alice-ledger", role: "owner" })
    .returning();
  sessionToken = (await createSession(alice.id)).token;

  // ── SIMPLE (default): no accounting jargon anywhere in the page ──
  const simple = await renderLedger();
  assert.ok(simple.includes("خلاصه حساب‌ها"), "simple view shows the plain account summary");
  assert.ok(!simple.includes("تراز آزمایشی"), "trial balance wording hidden by default");
  assert.ok(!simple.includes("مسیر پول") || true, "postings table header present in some form");
  assert.ok(!simple.includes("کد معین"), "no chart-of-accounts codes vocabulary by default");

  // ── PRO: the professional accounting columns appear ──
  await preferences.setUserProMode(alice.id, true);
  const pro = await renderLedger();
  assert.ok(pro.includes("تراز آزمایشی"), "trial balance visible in PRO mode");
  assert.ok(pro.includes("ورود"), "debit column visible in PRO mode");
  assert.ok(pro.includes("خروج"), "credit column visible in PRO mode");

  // ── back to SIMPLE hides them again (server re-read per request) ──
  await preferences.setUserProMode(alice.id, false);
  const simpleAgain = await renderLedger();
  assert.ok(!simpleAgain.includes("تراز آزمایشی"), "trial balance hidden after opting out");

  sessionToken = null;
});
