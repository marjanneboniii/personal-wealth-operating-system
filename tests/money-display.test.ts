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
 *      number-first order survives even inside dir="ltr" containers.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  currencyLabel,
  faCount,
  formatDualMoneyFromIrt,
  formatDualMoneyFromUsd,
  formatMoney,
  formatNumber,
} from "../src/lib/format";

const RLI = "\u2067";
const PDI = "\u2069";
const money = (v: string | number, c?: string) => formatMoney(v, c);

test("canonical amounts from the product spec render number-first", () => {
  assert.equal(money("3000000000", "IRT"), `${RLI}۳٬۰۰۰٬۰۰۰٬۰۰۰ تومان${PDI}`);
  assert.equal(money("15957", "USD"), `${RLI}۱۵٬۹۵۷ دلار${PDI}`);
  assert.equal(money("15957", "USDT"), `${RLI}۱۵٬۹۵۷ تتر${PDI}`);
});

test("zeros keep the same number-first order", () => {
  assert.equal(money(0, "IRT"), `${RLI}۰ تومان${PDI}`);
  assert.equal(money(0, "USD"), `${RLI}۰ دلار${PDI}`);
  assert.equal(money(0, "USDT"), `${RLI}۰ تتر${PDI}`);
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
    assert.ok(!/(USD|USDT|IRT)/.test(out.replace(RLI, "").replace(PDI, "")), `no raw code in ${out}`);
  }
});

test("currency order is always number → space → unit (unit never precedes)", () => {
  const out = money("15957", "USD").replace(RLI, "").replace(PDI, "");
  assert.ok(out.startsWith("۱۵٬۹۵۷"));
  assert.ok(out.endsWith("دلار"));
  assert.equal(out, "۱۵٬۹۵۷ دلار");
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
  assert.equal(currencyLabel("ETH"), "ETH");
  assert.equal(currencyLabel(null), "");
});

test("dual (equivalent-currency) previews follow the same standard", () => {
  const dual = formatDualMoneyFromIrt("3000000000", "200000");
  assert.equal(dual.irt, `${RLI}۳٬۰۰۰٬۰۰۰٬۰۰۰ تومان${PDI}`);
  assert.equal(dual.usd, `${RLI}۱۵٬۰۰۰ دلار${PDI}`);

  const fromUsd = formatDualMoneyFromUsd("15957", "200000");
  assert.equal(fromUsd.usd, `${RLI}۱۵٬۹۵۷ دلار${PDI}`);
  assert.ok(fromUsd.irt.includes("تومان"));
});

test("decimal separator is ASCII period, never Persian ٫", () => {
  const usd = money("34444.33", "USD");
  assert.ok(usd.includes("۳۴٬۴۴۴.۳۳"), usd);
  assert.ok(!usd.includes("٫"), usd);
  assert.ok(!usd.includes("/"), usd);
  assert.equal(formatNumber("34444.33", { decimals: 2 }), "۳۴٬۴۴۴.۳۳");
});

test("faCount renders UI counts in Persian digits", () => {
  assert.equal(faCount(3), "۳");
  assert.equal(faCount(12), "۱۲");
  assert.equal(faCount("0"), "۰");
});
