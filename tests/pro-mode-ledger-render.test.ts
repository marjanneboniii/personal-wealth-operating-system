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

test("§2 /ledger leads with plain language and keeps the accounting detail on demand", async () => {
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

  const page = await renderLedger();

  // The page LEADS with plain language — accounting vocabulary is never the
  // first thing a non-accountant meets.
  assert.ok(page.includes("خلاصه حساب‌ها"), "plain account summary leads the page");

  // The global «حالت حرفه‌ای» preference is gone: the accounting view is no
  // longer gated behind a setting the user has to discover.
  assert.ok(
    !page.includes("حالت حرفه‌ای"),
    "no app-wide professional-mode switch is referenced any more",
  );

  // …but NOTHING was removed. The trial balance and its debit/credit columns
  // stay reachable in the same request, inside a local expander.
  assert.ok(page.includes("جزئیات حسابداری"), "accounting detail is offered on the page");
  assert.ok(page.includes("تراز آزمایشی"), "trial balance is still rendered");
  assert.ok(page.includes("ورود") && page.includes("خروج"), "debit and credit columns survive");
  assert.ok(page.includes("کد"), "chart-of-accounts codes survive");

  // The preference no longer changes what the page shows.
  await preferences.setUserProMode(alice.id, true);
  const afterOptIn = await renderLedger();
  assert.ok(afterOptIn.includes("خلاصه حساب‌ها"), "the plain summary still leads");
});
