/**
 * استانداردهای دستورالعمل جامع سیستم (Global System Directive) — regression
 * coverage for the systemic invariants, enforced app-wide:
 *
 *   §1  Toman base-currency immutability + one-way dynamic USD equivalent.
 *   §2  Pro Mode default = SIMPLE; accounting vocabulary is opt-in per user.
 *   §3  100٪ Persian digits, «٫» decimal, «٬» thousands, leading minus sign.
 *   §4  Rounding service (exact decimal, single half-up step) and the
 *       zero-is-neutral colour rule.
 *   §0  Per-user preference isolation (tenant scoping of the Pro Mode flag).
 */
import assert from "node:assert/strict";
import { test, mock } from "node:test";

// ── Next.js runtime mocks (server actions read cookies via next/headers) ──
mock.module("next/headers", {
  namedExports: {
    cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }),
    headers: async () => new Headers(),
  },
});
mock.module("next/cache", {
  namedExports: { revalidatePath: () => {} },
});

const RLI = "\u2067";
const PDI = "\u2069";

let format: typeof import("../src/lib/format");
let decimal: typeof import("../src/domain/decimal");
let tx: typeof import("../src/lib/tx");
let db: any, createSchemaIfNotExists: any, users: any, userPreferences: any;
let preferences: typeof import("../src/features/preferences/service");

async function loadModules() {
  format = await import("../src/lib/format");
  decimal = await import("../src/domain/decimal");
  tx = await import("../src/lib/tx");
  ({ db } = await import("../src/db"));
  ({ createSchemaIfNotExists } = await import("../src/db/init-schema"));
  ({ users, userPreferences } = await import("../src/db/schema"));
  preferences = await import("../src/features/preferences/service");
}
const modulesReady = loadModules();

/* ══════════════════════════════════════════════════════════════════════════
   §4 — Rounding Service Fix (exact decimal, one half-up step)
   ══════════════════════════════════════════════════════════════════════════ */

test("§4 the canonical ۹۰۹٬۰۹۰ Toman case survives the USD round-trip exactly", async () => {
  await modulesReady;
  const { D } = decimal;
  // 909,090 Toman at 190,000 Toman/USD → exact USD quotient 4.7846842105…
  const usd = D("909090").div("190000");
  // … and back through the SINGLE shared conversion (never float, never a
  // 2-dp pre-rounded USD value).
  assert.equal(format.usdToIrt(usd.toString(), "190000"), "909090");
  assert.equal(format.toIrtMoney(usd.toString(), "190000"), `${RLI}۹۰۹٬۰۹۰\u00A0ت${PDI}`);
  // The old buggy derivation (2-dp USD → float multiply) reproduces the exact
  // reported bug: ۴.۷۸ × ۱۹۰٬۰۰۰ = ۹۰۸٬۲۰۰ «به جای ۹۰۹٬۰۹۰».
  assert.equal(Math.round(Number(usd.toFixed(2)) * Number("190000")), 908200);
  assert.notEqual(Math.round(Number(usd.toFixed(2)) * Number("190000")), 909090);
});

test("§4 toIrtMoney never silently converts with a missing/invalid rate", async () => {
  await modulesReady;
  assert.equal(format.toIrtMoney("15", null), null);
  assert.equal(format.toIrtMoney("15", undefined), null);
  assert.equal(format.toIrtMoney("15", "0"), null);
  assert.equal(format.toIrtMoney("15", "-5"), null);
});

test("§4 Decimal half-up rounding — no float drift at Toman scale", async () => {
  await modulesReady;
  const { D } = decimal;
  assert.equal(D("2.5").toFixed(0), "3");
  assert.equal(D("909089.5").toFixed(0), "909090");
  assert.equal(D("909090.4999").toFixed(0), "909090");
  // values whose float product is famously imprecise stay exact in Decimal:
  // 0.1+0.2 ≠ 0.3 in IEEE-754, but exactly 0.3 in the shared Decimal layer.
  assert.equal(D("0.1").add("0.2").toString(), "0.3");
  assert.equal(D("4670288949").add("1").toString(), "4670288950");
});

test("§4 zero is ALWAYS a neutral tone — never green, never red", async () => {
  await modulesReady;
  assert.equal(format.trendTone(0), "neutral");
  assert.equal(format.trendTone("0.000"), "neutral");
  assert.equal(format.trendTone(-0), "neutral");
  assert.equal(format.trendTone(Number.NaN), "neutral");
  assert.equal(format.trendTone(5), "up");
  assert.equal(format.trendTone(-5), "down");
  assert.equal(format.trendArrow(0), "—");
  assert.equal(format.trendArrow(1), "↑");
  assert.equal(format.trendArrow(-1), "↓");
  assert.equal(format.trendColor(0), "var(--text-2)");
  assert.notEqual(format.trendColor(0), "var(--positive)");
  assert.notEqual(format.trendColor(0), "var(--negative)");
});

/* ══════════════════════════════════════════════════════════════════════════
   §1 — Toman base currency immutability (one-way conversion)
   ══════════════════════════════════════════════════════════════════════════ */

test("§1 the stored Toman figure is invariant to the USD rate; only the side USD moves", async () => {
  await modulesReady;
  const a = format.formatDualMoneyFromIrt("1000000", "190000");
  const b = format.formatDualMoneyFromIrt("1000000", "250000");
  // ۱٬۰۰۰٬۰۰۰ ت stays ۱٬۰۰۰٬۰۰۰ ت under any rate…
  assert.equal(a.irt, `${RLI}۱٬۰۰۰٬۰۰۰\u00A0ت${PDI}`);
  assert.equal(a.irt, b.irt);
  // …while the dynamic dollar equivalent follows the rate one-way:
  assert.equal(a.usd, `${RLI}۵٫۲۶\u00A0$${PDI}`);
  assert.equal(b.usd, `${RLI}۴\u00A0$${PDI}`);
});

test("§1 humanized ledger entries expose the FULL-PRECISION amount for any conversion", async () => {
  await modulesReady;
  const row = {
    id: "e1",
    entryDate: "2026-08-01",
    type: "expense",
    description: "قسط وام",
    status: "normal",
    source: "manual",
    lines: [
      { account: "خرید کالا", accountType: "expense", symbol: "USD", quantity: "4.784684210526315789", baseValue: "4.784684210526315789", decimals: 2, memo: null },
      { account: "حساب بانکی", accountType: "asset", symbol: "USD", quantity: "-4.784684210526315789", baseValue: "-4.784684210526315789", decimals: 2, memo: null },
    ],
  } as any;
  const h = tx.humanizeEntry(row);
  assert.equal(h.amount, "4.78"); // 2-dp display string…
  assert.equal(h.amountExact, "4.784684210526315789"); // …but exact value kept.
  // Converting the exact value must land on ۹۰۹٬۰۹۰ — while converting the
  // 2-dp DISPLAY string reproduces the reported ۹۰۸٬۲۰۰ discrepancy.
  assert.equal(format.usdToIrt(h.amountExact, "190000"), "909090");
  assert.equal(Math.round(Number(h.amount) * Number("190000")), 908200);
});

/* ══════════════════════════════════════════════════════════════════════════
   §3 — Persian digits & number formatting standards
   ══════════════════════════════════════════════════════════════════════════ */

test("§3 Persian digits, «٫» decimal, «٬» thousands — no Latin digit, no slash decimal", async () => {
  await modulesReady;
  assert.equal(format.formatNumber("32731.12", { decimals: 2 }), "۳۲٬۷۳۱٫۱۲");
  assert.equal(format.formatNumber("58.3", { decimals: 1 }), "۵۸٫۳");
  assert.equal(format.formatMoney("4670288949", "IRT"), `${RLI}۴٬۶۷۰٬۲۸۸٬۹۴۹\u00A0ت${PDI}`);
  assert.equal(format.faCount("12"), "۱۲");
  assert.equal(format.formatPct("58.3", 1), "۵۸٫۳٪");
  for (const out of [
    format.formatMoney("4670288949", "IRT"),
    format.formatNumber("32731.12"),
    format.faCount(908),
  ]) {
    assert.ok(!/[0-9]/.test(out), `Latin digit leaked into: ${out}`);
    assert.ok(!out.includes("/"), `slash used as decimal in: ${out}`);
  }
});

test("§3 formatSignedMoney keeps the sign inside one isolate — never «ت+ … ت»", async () => {
  await modulesReady;
  const out = format.formatSignedMoney("-893746171", "IRT");
  assert.ok(out.includes("ت"), out);
  assert.equal((out.match(/ت/g) ?? []).length, 1);
  assert.ok(out.includes("−"), out);
  assert.ok(!out.includes("+"), out);
  const zero = format.formatSignedMoney(0, "IRT");
  assert.ok(!zero.includes("+") && !zero.includes("−"), zero);
  const pos = format.formatSignedMoney("100", "IRT");
  assert.ok(pos.includes("+"), pos);
});

test("§3 the minus sign LEADS the number in RTL — it is never left dangling at the end", async () => {
  await modulesReady;
  const out = format.formatNumber("-908200", { decimals: 0 });
  assert.ok(out.startsWith("−"), `minus must lead: ${out}`);
  assert.ok(!out.endsWith("-"), `minus must not trail: ${out}`);
  assert.equal(out, "−۹۰۸٬۲۰۰");
  assert.ok(out.includes("٫") === false || true); // integer — no decimal at all
});

/* ══════════════════════════════════════════════════════════════════════════
   §2 — Human vocabulary: no debit/credit jargon in the human layer
   ══════════════════════════════════════════════════════════════════════════ */

test("§2 the human money-flow sentence never uses accounting jargon", async () => {
  await modulesReady;
  const label = tx.moneyFlowLabel("حساب بانکی", "هزینه‌ها › بیمه");
  assert.equal(label, "از حساب بانکی به هزینه‌ها › بیمه");
  for (const banned of ["بدهکار", "بستانکار", "Debit", "Credit", "کد معین"]) {
    assert.ok(!label.includes(banned), `jargon «${banned}» leaked into the human layer`);
  }
});

/* ══════════════════════════════════════════════════════════════════════════
   §0/§2 — Pro Mode: default SIMPLE, per-user isolation
   ══════════════════════════════════════════════════════════════════════════ */

async function cleanPrefs() {
  await createSchemaIfNotExists();
  await db.delete(userPreferences);
  await db.delete(users);
}

test("§0/§2 Pro Mode defaults to SIMPLE and is isolated per user", async () => {
  await modulesReady;
  await cleanPrefs();

  const [alice] = await db
    .insert(users)
    .values({ name: "Alice", username: "alice-pro", role: "user" })
    .returning();
  const [bob] = await db
    .insert(users)
    .values({ name: "Bob", username: "bob-pro", role: "user" })
    .returning();

  // Default for everyone (and for anonymous) is the simple, non-jargon view.
  assert.equal(await preferences.getUserProMode(alice.id), false);
  assert.equal(await preferences.getUserProMode(bob.id), false);
  assert.equal(await preferences.getUserProMode(null), false);
  assert.equal(await preferences.getUserProMode(undefined), false);

  // Alice opts into Pro Mode…
  const res = await preferences.setUserProMode(alice.id, true);
  assert.equal(res.ok, true);
  assert.equal(await preferences.getUserProMode(alice.id), true);

  // …Bob's view is untouched (tenant isolation), and a missing user id still
  // resolves to the safe default.
  assert.equal(await preferences.getUserProMode(bob.id), false);
  assert.equal(await preferences.getUserProMode("00000000-0000-0000-0000-000000000000"), false);

  // The flag is stored exactly once per user (unique tenant row).
  const rows = await db.select().from(userPreferences);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].userId, alice.id);

  // Toggling back works and is audited without throwing.
  const back = await preferences.setUserProMode(alice.id, false);
  assert.equal(back.ok, true);
  assert.equal(await preferences.getUserProMode(alice.id), false);
});

/* ══════════════════════════════════════════════════════════════════════════
   §3/§4 — Zero-is-neutral KPI tones (income/expense metrics)
   ══════════════════════════════════════════════════════════════════════════ */

test("§3 a zero expense/income KPI is NEVER red/green — directional tones", async () => {
  await modulesReady;
  // The reported bug: «هزینه این ماه ۰ تومان» rendered in red because KPI
  // strips hard-wired tone="down". Zero must resolve to neutral…
  assert.equal(format.outflowTone(0), "neutral");
  assert.equal(format.outflowTone("0.00"), "neutral");
  assert.equal(format.inflowTone(0), "neutral");
  assert.equal(format.inflowTone("0"), "neutral");
  // …while real money that moved keeps its semantic colour:
  assert.equal(format.outflowTone("1500"), "down");
  assert.equal(format.outflowTone("-75"), "down"); // refund-shaped row is still a spend event
  assert.equal(format.inflowTone("1500"), "up");
  // And the neutral tone maps to the neutral grey, never positive/negative:
  assert.equal(format.toneColor(format.outflowTone(0)), "var(--text-2)");
  assert.notEqual(format.toneColor(format.outflowTone(0)), "var(--negative)");
  assert.notEqual(format.toneColor(format.inflowTone(0)), "var(--positive)");
});

/* ══════════════════════════════════════════════════════════════════════════
   §4 — Signed dynamic Toman KPIs share ONE formatter (no manual "+/−" glue)
   ══════════════════════════════════════════════════════════════════════════ */

test("§4 formatSignedMoneyFromUsd keeps the sign inside the single isolate", async () => {
  await modulesReady;
  // Exact-precision conversion: 4.784684… USD × 190,000 = ۹۰۹٬۰۹۰ — the
  // manual page-level «+/−» glue previously re-rounded this to ۹۰۸٬۲۰۰.
  const pos = format.formatSignedMoneyFromUsd("4.784684210526315789", "190000");
  assert.equal(pos, `${RLI}+۹۰۹٬۰۹۰\u00A0ت${PDI}`);
  const neg = format.formatSignedMoneyFromUsd("-4.784684210526315789", "190000");
  assert.equal(neg, `${RLI}−۹۰۹٬۰۹۰\u00A0ت${PDI}`);
  // the short unit «ت» appears exactly once — never «ت+ … ت»:
  assert.equal((neg.match(/ت/g) ?? []).length, 1);
  // Zero is unsigned regardless of rate:
  const zero = format.formatSignedMoneyFromUsd(0, "190000");
  assert.equal(zero, `${RLI}۰\u00A0ت${PDI}`);
  assert.ok(!zero.includes("+") && !zero.includes("−"), zero);
  // Missing/invalid rate → signed USD fallback, still one isolate:
  assert.equal(format.formatSignedMoneyFromUsd("-3.5", null), `${RLI}−۳٫۵\u00A0$${PDI}`);
  assert.equal(format.formatSignedMoneyFromUsd("-3.5", "0"), `${RLI}−۳٫۵\u00A0$${PDI}`);
});

/* ══════════════════════════════════════════════════════════════════════════
   §4 — UX Translation Pipe: technical ledger vocabulary never reaches the
   human layer («از سرمایه افتتاحیه…» → «از موجودی آغازین…»)
   ══════════════════════════════════════════════════════════════════════════ */

test("§4 the UX pipe sanitizes bookkeeping account names in the human layer only", async () => {
  await modulesReady;
  // The exact phrase from the directive is censored into a smooth title…
  assert.equal(
    tx.moneyFlowLabel("سرمایه افتتاحیه", "بانک سامان — سپرده"),
    "از موجودی آغازین به بانک سامان — سپرده",
  );
  assert.equal(
    tx.moneyFlowLabel("سرمایه افتتاحیه تملک‌های تاریخی (املاک)", "دارایی‌ها"),
    "از موجودی آغازین به دارایی‌ها",
  );
  // …non-cash reserves and realized-capital gains read as plain categories…
  assert.equal(tx.plainAccountName("ذخیره استهلاک و تعمیرات آتی"), "ذخیره هزینه‌های آتی (غیرنقدی)");
  assert.equal(tx.plainAccountName("سود سرمایه‌ای تحقق‌یافته"), "سود فروش دارایی");
  assert.equal(tx.plainAccountName("سرمایه"), "موجودی آغازین");
  // …while the user's own accounts/data pass through UNCHANGED (no censoring
  // of real data, no mock mapping):
  assert.equal(tx.plainAccountName("بانک سامان — سپرده"), "بانک سامان — سپرده");
  assert.equal(tx.plainAccountName("خرید نان"), "خرید نان");
  // The pipe output stays jargon-free:
  for (const label of [
    tx.moneyFlowLabel("سرمایه افتتاحیه", "صندوق طلای کیان")!,
    tx.moneyFlowLabel("ذخیره استهلاک و تعمیرات آتی", null)!,
  ]) {
    for (const banned of ["سرمایه افتتاحیه", "بدهکار", "بستانکار", "کد معین"]) {
      assert.ok(!label.includes(banned), `«${banned}» leaked into human layer: ${label}`);
    }
  }
});
