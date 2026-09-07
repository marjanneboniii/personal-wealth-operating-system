/**
 * «کاهش معادل دلاری» — clarity regression (reported from a real iPhone PWA
 * screenshot of بدهی → اقساط).
 *
 * Two defects the screenshot showed:
 *
 *  1. A dollar delta with a rounded percent floated in a summary band with no
 *     balance and no rates next to it, which is not readable money. The rule
 *     now: the aggregate is spelled out as an arithmetic statement — the frozen
 *     Toman balance, the rate it was booked at, the live rate, and the two
 *     dollar figures each one produces — AND the same delta is written on every
 *     installment row it belongs to, because per-installment is what the user
 *     asked to read.
 *
 *  2. «17 روز دیگر» rendered with the number shuffled AFTER the word «روز».
 *     The countdown phrase sat inside the card's `dir="ltr"` date row, so the
 *     bidi algorithm split the Persian words away from their number. The fix is
 *     the repo's own money pattern: ONE helper builds the phrase and wraps it in
 *     an RTL isolate, so its visual order can never depend on the container.
 *
 * Like the other page-level tests here (jalali-only-due-dates,
 * obligations-90day-scope) this renders the REAL component, so a reintroduced
 * hand-written countdown or a summary that drops its rates fails the suite.
 *
 * NB: every Persian-digit string below is DERIVED from the Latin figures with
 * toFaDigits/fa() — no hand-typed Persian digits, so the expectations can never
 * drift away from the formatter they check.
 */
import assert from "node:assert/strict";
import { test, mock } from "node:test";
import fs from "node:fs";
import path from "node:path";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { D } from "../src/domain/decimal";
import {
  buildInstallmentFxView,
  summarizePendingUsdChange,
} from "../src/features/planning/installmentFx";
import {
  formatDaysUntil,
  formatDaysWindow,
  formatJalaliIso,
  toFaDigits,
} from "../src/lib/format";

const RLI = "\u2067"; // RIGHT-TO-LEFT ISOLATE
const PDI = "\u2069"; // POP DIRECTIONAL ISOLATE
/** Every bidi mark / NBSP the formatters emit — ONE character class, so a
 *  rendered line can be read as the user reads it (marks are invisible and are
 *  NOT whitespace: leaving them in breaks any contiguous-phrase assertion). */
const INVISIBLE = "[\u2066\u2067\u2068\u2069\u00A0\u200E\u200F]";
const deInvisible = (s: string) => s.replace(new RegExp(INVISIBLE, "g"), " ").replace(/\s+/g, " ").trim();
/** Persian ۰ … ۹ by codepoint, so no test literal depends on typed glyphs. */
const FA_RANGE = `${String.fromCharCode(0x06f0)}-${String.fromCharCode(0x06f9)}`;
/** Latin figure string → the app's own Persian rendering, grouping included. */
function fa(raw: string): string {
  const [int, frac] = raw.replace(/,/g, "").split(".");
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, "\u066c");
  return toFaDigits(frac ? `${grouped}.${frac}` : grouped);
}
/** The phrase the user must see, with NBSPs flattened to normal spaces. */
const phrase = (s: string) => deInvisible(s);

/* ─────────────────────── 1. the shared phrase builder ─────────────────────── */

test("formatDaysUntil puts the number FIRST and isolates the phrase", () => {
  const soon = formatDaysUntil(17);
  // The isolate is what pins «number → روز → قید» when the container is dir="ltr".
  assert.ok(soon.startsWith(RLI) && soon.endsWith(PDI), "wrapped in a right-to-left isolate");
  const inner = phrase(soon);
  assert.equal(inner, `${fa("17")} روز دیگر`);
  assert.ok(inner.indexOf(fa("17")) === 0, "the number opens the phrase");
  assert.ok(inner.indexOf("روز دیگر") > 0, "«روز» follows its number, never precedes it");

  assert.equal(
    phrase(formatDaysUntil(-3)),
    `${fa("3")} روز گذشته`,
    "an overdue row is number-first too",
  );
  assert.equal(phrase(formatDaysUntil(0)), "امروز");
  // An unusable date must never fabricate «0 days» or «NaN».
  assert.equal(phrase(formatDaysUntil(Number.NaN)), "زمان نامشخص");
});

test("formatDaysWindow is number-first too (no leading preposition)", () => {
  const label = formatDaysWindow(30);
  assert.ok(label.startsWith(RLI) && label.endsWith(PDI), "KPI captions are isolated as well");
  assert.equal(phrase(label), `${fa("30")} روز آینده`);
  assert.ok(!label.includes("در "), "the caption opens with its number, not with «در»");
});

/* ─────────────── 2. the aggregate carries its own arithmetic ─────────────── */

const TOMAN_BALANCE = "86818180"; // the screenshot's remaining balance
const BOOKED_RATE = "200000"; // the rate those rows were booked at
const LIVE_RATE = "220000"; // today's rate

const pendingView = (amountToman: string, originalFxRate: string, live = LIVE_RATE) =>
  buildInstallmentFxView({ status: "pending", amountToman, originalFxRate }, live);

/** The three dollar figures the card must show, derived the same way the page derives them. */
const bookingUsd = D(TOMAN_BALANCE).div(BOOKED_RATE).toFixed(2);
const liveUsd = D(TOMAN_BALANCE).div(LIVE_RATE).toFixed(2);
const deltaUsd = D(bookingUsd).sub(liveUsd).toFixed(2);
const deltaPct = D(deltaUsd).div(bookingUsd).mul("100").toFixed(1);

test("summarizePendingUsdChange returns the balance and BOTH rates", () => {
  const insight = summarizePendingUsdChange(
    [pendingView("50000000", BOOKED_RATE), pendingView("36818180", BOOKED_RATE)],
    LIVE_RATE,
  )!;
  assert.ok(insight, "a pending schedule with snapshots produces an insight");
  assert.equal(insight.amountToman, TOMAN_BALANCE, "the frozen Toman balance belongs to the insight");
  assert.equal(insight.currentFxRate, LIVE_RATE, "the live rate is labelled, never implied");
  assert.equal(insight.avgOriginalFxRate, BOOKED_RATE, "booking rate = balance ÷ original USD");
  // The insight keeps full precision; the card shows the 2-dp display value.
  assert.equal(D(insight.originalUsd).toFixed(2), bookingUsd);
  assert.equal(D(insight.currentUsd).toFixed(2), liveUsd);
  assert.equal(insight.direction, "decrease", "a weaker rial shrinks the dollar obligation");
  assert.equal(insight.count, 2);
  assert.equal(insight.missingOriginalCount, 0);
});

test("a row without a booking snapshot is counted, never silently dropped", () => {
  const legacy = buildInstallmentFxView({ status: "pending", amountToman: "10000000" }, LIVE_RATE);
  const insight = summarizePendingUsdChange(
    [pendingView("50000000", BOOKED_RATE), legacy],
    LIVE_RATE,
  )!;
  assert.equal(insight.count, 1, "only the comparable row enters the math");
  assert.equal(insight.missingOriginalCount, 1, "…and the UI is told to disclose the other one");
});

/* ────────────────────────── 3. the real page ────────────────────────────── */

const cookieJar: { value: string | null } = { value: null };
mock.module("next/headers", {
  namedExports: {
    cookies: async () => ({
      get: () => (cookieJar.value ? { value: cookieJar.value } : undefined),
      set: () => {},
      delete: () => {},
    }),
    headers: async () => new Headers(),
  },
});
mock.module("next/cache", { namedExports: { revalidatePath: () => {} } });
mock.module("next/navigation", {
  namedExports: { redirect: () => {}, useRouter: () => ({ refresh: () => {}, push: () => {} }) },
});
mock.module("next/link", {
  defaultExport: (props: any) =>
    React.createElement("a", { href: props.href, className: props.className }, props.children),
});
mock.module("@/lib/authGuard", { namedExports: { ensureAuth: async () => ({ id: "u1" }) } });
mock.module("@/db/seed", { namedExports: { seedIfEmpty: async () => {} } });
const dbStub: any = {
  select: () => dbStub,
  from: () => dbStub,
  leftJoin: () => dbStub,
  where: () => dbStub,
  orderBy: () => dbStub,
  limit: async () => [{ id: "acc-cash" }],
};
mock.module("@/db", { namedExports: { db: dbStub } });
mock.module("@/components/RowAction", {
  defaultExport: () => React.createElement("button", { type: "button" }, "پرداخت سریع"),
});

const iso = (dayOffset: number) =>
  new Date(Date.now() + dayOffset * 86_400_000).toISOString().slice(0, 10);

const DAYS_LEFT = 17; // → «17 روز دیگر»
const DUE_PENDING = iso(DAYS_LEFT);
const DUE_PAID = iso(-40);
const PAID_AT = iso(-38);

const rows = [
  {
    id: "inst-paid",
    seq: 1,
    title: "قسط بیمه شخص ثالث",
    creditor: "azki",
    dueDate: DUE_PAID,
    fx: buildInstallmentFxView(
      {
        status: "paid",
        amountToman: "909090",
        originalFxRate: BOOKED_RATE,
        paidToman: "909090",
        paidFxRate: "190000",
        paidUsd: D("909090").div("190000").toString(),
        paidAt: PAID_AT,
      },
      LIVE_RATE,
    ),
  },
  {
    id: "inst-pending",
    seq: 2,
    title: "قسط بیمه شخص ثالث",
    creditor: "azki",
    dueDate: DUE_PENDING,
    fx: pendingView(TOMAN_BALANCE, BOOKED_RATE),
  },
];

mock.module("@/features/planning/service", {
  namedExports: {
    listInstallmentSchedule: async () => ({
      rate: LIVE_RATE,
      rows,
      pendingUsdInsight: summarizePendingUsdChange(
        rows.map((r) => r.fx),
        LIVE_RATE,
      ),
    }),
  },
});

let cached: { html: string; visible: string } | null = null;
async function render() {
  if (cached) return cached;
  const { default: InstallmentsPage } = await import("../src/app/installments/page");
  const html = renderToStaticMarkup(await (InstallmentsPage as any)());
  // Attributes are stripped (deep links legitimately carry the ISO date) and the
  // invisible bidi marks / NBSPs the formatters emit become plain spaces, so the
  // assertions read a line the way the user sees it.
  const visible = html
    .replace(/<[^>]*>/g, " ")
    .replace(new RegExp(INVISIBLE, "g"), " ")
    .replace(/\s+/g, " ")
    .trim();
  cached = { html, visible };
  return cached;
}

test("the aggregate card states its balance, both rates and the two dollar figures", async () => {
  const { visible } = await render();
  assert.ok(visible.includes("زمان‌بندی اقساط"), "the schedule section renders");
  assert.ok(visible.includes("مانده اقساط پرداخت‌نشده"), "the Toman balance is labelled");
  assert.ok(visible.includes(fa(TOMAN_BALANCE)), "…and the balance itself is on screen");
  assert.ok(visible.includes("با نرخ زمان ثبت"), "the booking rate is named");
  assert.ok(visible.includes("با نرخ روز"), "the live rate is named");
  assert.ok(visible.includes(fa(BOOKED_RATE)), "the booking rate is shown as a number");
  assert.ok(visible.includes(fa(LIVE_RATE)), "the live rate is shown as a number");
  // Both dollar sides, so the claim can be checked by hand:
  // balance ÷ booked rate, balance ÷ live rate, and their difference.
  for (const [label, value] of [
    ["USD at the booking rate", bookingUsd],
    ["USD at the live rate", liveUsd],
    ["the delta in dollars", deltaUsd],
  ] as const) {
    assert.ok(visible.includes(`${fa(value)} دلار`), `${label} (${value}) is on screen`);
  }
  assert.ok(
    visible.includes(`${fa(deltaPct)}٪`),
    "the percent keeps a decimal — the old rounded figure was what read as nonsense",
  );
  assert.ok(visible.includes("کمتر از زمان ثبت"), "and the direction is stated in words");
});

test("a falling dollar obligation is not painted as a loss", async () => {
  const { html } = await render();
  // For a LIABILITY, fewer dollars is good news. The old card painted a decrease
  // in the loss colour — half of why the band read as nonsense.
  const idx = html.indexOf("کمتر از زمان ثبت");
  assert.ok(idx > 0, "the direction word is rendered");
  const openTag = html.lastIndexOf("<div", idx);
  const tag = html.slice(openTag, html.indexOf(">", openTag) + 1);
  assert.ok(
    tag.includes("var(--positive)") && !tag.includes("var(--negative)"),
    `the delta line carries the favourable colour, got: ${tag}`,
  );
});

test("each installment writes its own dollar delta; a paid row stays frozen", async () => {
  const { html, visible } = await render();
  assert.ok(visible.includes("معادل فعلی:"), "pending row shows its live equivalent");
  assert.ok(visible.includes("معادل هنگام پرداخت:"), "paid row shows its payment snapshot");
  // The very same percent the aggregate reports, attached to the row that made it.
  assert.ok(
    visible.includes(`از ${fa(bookingUsd)} دلار`),
    "the row names the USD figure it is being compared with",
  );
  assert.ok(/کمتر|بیشتر/.test(html.slice(html.indexOf("معادل فعلی:"), html.indexOf("سررسید"))), "row delta");

  const paidIdx = html.indexOf("معادل هنگام پرداخت:");
  assert.ok(paidIdx > 0);
  assert.ok(
    !/کمتر|بیشتر/.test(html.slice(paidIdx, paidIdx + 260)),
    "a paid row's dollar figure is history: no delta, no live rate on that line",
  );
});

test("the countdown reads «number, روز, دیگر» in that order", async () => {
  const { html, visible } = await render();
  const expected = formatDaysUntil(DAYS_LEFT);
  assert.ok(
    html.includes(expected),
    "the schedule renders the shared phrase builder verbatim (isolate included)",
  );
  assert.equal(
    phrase(expected),
    `${fa(String(DAYS_LEFT))} روز دیگر`,
  );
  const i = visible.indexOf(`${fa(String(DAYS_LEFT))} روز دیگر`);
  assert.ok(i > 0, "the number stays in front of «روز» in the rendered text");
});

test("no countdown phrase is ever dropped into a dir=ltr container", () => {
  const src = fs.readFileSync(path.resolve(process.cwd(), "src/app/installments/page.tsx"), "utf-8");
  assert.ok(
    src.includes("formatDaysUntil(") && src.includes("formatDaysWindow("),
    "the page uses the shared day-count helpers instead of hand-built strings",
  );
  assert.ok(
    !/dir="ltr"[^>]*>[\s\S]{0,220}?formatDaysUntil\(/.test(src),
    "the original bug: a Persian countdown inside the LTR date row of the mobile card",
  );
  assert.ok(!src.includes('label="در '), "the KPI caption opens with its number, not «در»");
  // Every other page that shows a countdown shares the one helper.
  for (const file of [
    "src/app/debts/page.tsx",
    "src/app/debts/obligations/page.tsx",
    "src/app/planning/page.tsx",
    "src/components/overview/OverviewDashboard.tsx",
  ]) {
    const s = fs.readFileSync(path.resolve(process.cwd(), file), "utf-8");
    assert.ok(s.includes("formatDaysUntil("), `${file} uses the shared countdown helper`);
    assert.ok(!/روز (دیگر|گذشته)`/.test(s), `${file} builds no ad-hoc countdown template`);
  }
});

test("a paid card states the payment date once and keeps the due date as a note", async () => {
  const { visible } = await render();
  assert.ok(visible.includes("پرداخت"), "the paid row is labelled as a payment");
  assert.ok(visible.includes(toFaDigits(formatJalaliIso(PAID_AT, "en"))), "…showing when it was paid");
  assert.ok(visible.includes(toFaDigits(formatJalaliIso(DUE_PAID, "en"))), "…with the due date kept as secondary info");
  assert.ok(
    !new RegExp(`پرداخت در [${FA_RANGE}\\/]+ [${FA_RANGE}\\/]+`).test(visible),
    "the old «پرداخت در <date> <date>» row (due date + paid date side by side, which read as a duplicated date) is gone",
  );
});

test("quick pay stays offered for pending rows only", async () => {
  const { visible } = await render();
  // The page ships BOTH layouts (mobile cards + desktop table) and switches
  // between them with CSS, so one pending row = two copies of the action.
  assert.equal(
    visible.split("پرداخت سریع").length - 1,
    2,
    "the pending installment gets the quick-pay action in each layout, and the paid one never does",
  );
});
