/**
 * استاندارد نمایش مبلغ در کل UI — regression coverage for the shared money
 * formatter (`src/lib/format.ts`), the single source of truth every page,
 * chart, modal, drawer and export renders money through.
 *
 * The contract (UI/Presentation ONLY — no accounting/ledger/FX change):
 *   1. Logical order is ALWAYS  عدد → فاصله → نام فارسی ارز
 *      (e.g. «۱۵٬۹۵۷ دلار», never «دلار ۱۵٬۹۵۷»).
 *   2. IRT→تومان, USD→دلار, USDT→تتر. USD and USDT are NEVER conflated.
 *   3. No Latin digits, no "$", no raw USD/USDT/IRT codes in user output.
 *   4. Persian thousand separator «٬» everywhere.
 *   5. The string is wrapped in Unicode bidi isolates (RLI…PDI) so the
 *      number-first order survives even inside dir="ltr" containers, and the
 *      numeric run itself sits in a nested LTR isolate (LRI…PDI) so a
 *      negative amount reads «−۱۲۳٬۴۵۶ تومان», never «۱۲۳٬۴۵۶− تومان».
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  currencyLabel,
  faCount,
  formatDualMoneyFromIrt,
  formatDualMoneyFromUsd,
  formatMoney,
  formatMoneyWithSign,
  formatNumber,
  formatPct,
  formatPercent,
  formatSignedMoney,
  formatSignedPct,
} from "../src/lib/format";

const RLI = "\u2067";
const LRI = "\u2066";
const PDI = "\u2069";
/** The full expected markup: «RLI LRI <digits> PDI NBSP <unit> PDI». */
const wrapped = (digits: string, unit: string) =>
  `${RLI}${LRI}${digits}${PDI}\u00a0${unit}${PDI}`;
/** Same string with every invisible bidi control removed, for order asserts. */
const bare = (s: string) => s.replace(/[\u2066\u2067\u2068\u2069]/g, "");
const money = (v: string | number, c?: string) => formatMoney(v, c);

test("canonical amounts from the product spec render number-first", () => {
  assert.equal(money("3000000000", "IRT"), wrapped("۳٬۰۰۰٬۰۰۰٬۰۰۰", "تومان"));
  assert.equal(money("15957", "USD"), wrapped("۱۵٬۹۵۷", "دلار"));
  assert.equal(money("15957", "USDT"), wrapped("۱۵٬۹۵۷", "تتر"));
});

test("zeros keep the same number-first order", () => {
  assert.equal(money(0, "IRT"), wrapped("۰", "تومان"));
  assert.equal(money(0, "USD"), wrapped("۰", "دلار"));
  assert.equal(money(0, "USDT"), wrapped("۰", "تتر"));
});

test("USD and USDT stay fully separate denominations", () => {
  assert.notEqual(money("15957", "USD"), money("15957", "USDT"));
  assert.ok(money("15957", "USDT").includes("تتر"));
  assert.ok(!money("15957", "USDT").includes("دلار"));
  assert.ok(money("15957", "USD").includes("دلار"));
});

test("never shows a currency sign or a raw ticker code", () => {
  for (const [v, c] of [["15957", "USD"], ["15957", "USDT"], ["3000000000", "IRT"]] as const) {
    const out = money(v, c);
    assert.ok(!out.includes("$"), `no $ in ${out}`);
    assert.ok(!/[0-9]/.test(out), `no Latin digits in ${out}`);
    assert.ok(!/(USD|USDT|IRT)/.test(bare(out)), `no raw code in ${out}`);
  }
});

test("currency order is always number → space → unit (unit never precedes)", () => {
  const out = bare(money("15957", "USD"));
  assert.ok(out.startsWith("۱۵٬۹۵۷"));
  assert.ok(out.endsWith("دلار"));
  assert.equal(out, "۱۵٬۹۵۷\u00a0دلار");
});

test("money strings carry bidi isolation so dir=\"ltr\" wrappers cannot flip the order", () => {
  const out = money("15957", "USD");
  assert.ok(out.startsWith(RLI) && out.endsWith(PDI), "wrapped in RLI…PDI");
});

test("currencyLabel maps codes (case-insensitive) and passes unknown tickers through", () => {
  assert.equal(currencyLabel("IRT"), "تومان");
  assert.equal(currencyLabel("USD"), "دلار");
  assert.equal(currencyLabel("USDT"), "تتر");
  assert.equal(currencyLabel("usdt"), "تتر");
  // «ETH» is no longer left as a Latin ticker: tables, cards and asset lists
  // read the asset's Persian name.
  assert.equal(currencyLabel("ETH"), "اتریوم");
  assert.equal(currencyLabel("eth"), "اتریوم");
  const ethMoney = formatMoney("4", "ETH");
  assert.ok(/۴[\s\u00a0]اتریوم/.test(bare(ethMoney)), "number → space → unit, in Persian");
  assert.ok(!ethMoney.includes("ETH"), "the Latin ticker never reaches the screen");
  assert.equal(currencyLabel("GOLD18"), "GOLD18", "an unmapped code still passes through");
  assert.equal(currencyLabel(null), "");
});

test("dual (equivalent-currency) previews follow the same standard", () => {
  const dual = formatDualMoneyFromIrt("3000000000", "200000");
  assert.equal(dual.irt, wrapped("۳٬۰۰۰٬۰۰۰٬۰۰۰", "تومان"));
  assert.equal(dual.usd, wrapped("۱۵٬۰۰۰", "دلار"));

  const fromUsd = formatDualMoneyFromUsd("15957", "200000");
  assert.equal(fromUsd.usd, wrapped("۱۵٬۹۵۷", "دلار"));
  assert.ok(fromUsd.irt.includes("تومان"));
});

test("decimal separator is ASCII period, never Persian ٫", () => {
  const usd = money("34444.33", "USD");
  assert.ok(usd.includes("۳۴٬۴۴۴.۳۳"), usd);
  assert.ok(!usd.includes("٫"), usd);
  assert.ok(!usd.includes("/"), usd);
  assert.equal(bare(formatNumber("34444.33", { decimals: 2 })), "۳۴٬۴۴۴.۳۳");
});

test("faCount renders UI counts in Persian digits", () => {
  assert.equal(faCount(3), "۳");
  assert.equal(faCount(12), "۱۲");
  assert.equal(faCount("0"), "۰");
});

/*
 * ── Sign placement ──────────────────────────────────────────────────────
 * Persian digits are bidi class AN and "−"/"+" are class ES, so the rule
 * that binds a sign to the number after it never fires: inside an RTL run
 * the sign is a neutral and lands on the FAR side of the digits. Every
 * numeric string therefore carries a nested LTR isolate. These tests assert
 * the sign is adjacent to the FIRST digit in logical order AND that the
 * isolate that makes it render there is actually present.
 */
const startsSigned = (out: string, sign: string) => {
  const inner = out.slice(out.indexOf(LRI) + 1, out.indexOf(PDI));
  return inner.startsWith(sign) && /^[۰-۹]/.test(inner.slice(sign.length));
};

test("a loss puts «−» BEFORE its digits, inside an LTR isolate", () => {
  const loss = formatMoney("-893746171", "IRT");
  assert.ok(loss.includes(LRI), "numeric run is LTR-isolated");
  assert.ok(startsSigned(loss, "−"), loss);
  assert.equal(bare(loss), "−۸۹۳٬۷۴۶٬۱۷۱\u00a0تومان");
});

test("formatSignedMoney forces the sign and keeps it in front of the digits", () => {
  assert.equal(bare(formatSignedMoney("-1234.5", "USD")), "−۱٬۲۳۴.۵\u00a0دلار");
  assert.equal(bare(formatSignedMoney("1234.5", "USD")), "+۱٬۲۳۴.۵\u00a0دلار");
  assert.ok(startsSigned(formatSignedMoney("-1234.5", "USD"), "−"));
  assert.ok(startsSigned(formatSignedMoney("1234.5", "USD"), "+"));
  // Zero is neutral: unsigned, exactly like formatMoney.
  assert.equal(formatSignedMoney("0", "IRT"), formatMoney("0", "IRT"));
});

test("formatMoneyWithSign carries a caller-chosen sign and «≈» inside the isolate", () => {
  assert.equal(bare(formatMoneyWithSign("−", "5000", "IRT")), "−۵٬۰۰۰\u00a0تومان");
  assert.equal(bare(formatMoneyWithSign("+", "5000", "IRT", "≈ ")), "≈ +۵٬۰۰۰\u00a0تومان");
  assert.equal(bare(formatMoneyWithSign("", "5000", "IRT")), "۵٬۰۰۰\u00a0تومان");
});

test("percents keep sign and ٪ on the correct side of the digits", () => {
  assert.equal(bare(formatPct("-8.3", 1)), "−۸.۳٪");
  assert.equal(bare(formatPct("8.3", 1)), "۸.۳٪");
  assert.equal(bare(formatPercent("-8.3")), "−۸.۳۰٪");
  assert.equal(bare(formatPercent("8.3")), "+۸.۳۰٪");
  assert.equal(bare(formatSignedPct("-8.3", 2)), "−۸.۳۰٪");
  assert.equal(bare(formatSignedPct("8.3", 2)), "+۸.۳۰٪");
  assert.equal(bare(formatSignedPct("0", 2)), "۰.۰۰٪");
  // ٪ lives INSIDE the numeric isolate, so it can never swap to the front.
  const pct = formatPct("-8.3", 1);
  assert.ok(pct.slice(pct.indexOf(LRI) + 1, pct.indexOf(PDI)).endsWith("٪"), pct);
});

test("negative bare numbers and quantities lead with «−» too", () => {
  assert.equal(bare(formatNumber("-1234.5", { decimals: 1 })), "−۱٬۲۳۴.۵");
  assert.ok(formatNumber("-1234.5", { decimals: 1 }).startsWith(LRI));
  // isolate:false is the composition escape hatch — no controls emitted.
  assert.equal(formatNumber("-1234.5", { decimals: 1, isolate: false }), "−۱٬۲۳۴.۵");
});
