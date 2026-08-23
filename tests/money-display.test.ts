/**
 * استاندارد نمایش مبلغ در کل UI — regression coverage for the shared money
 * formatter (`src/lib/format.ts`), the single source of truth every page,
 * chart, modal, drawer and export renders money through.
 *
 * The contract (UI/Presentation ONLY — no accounting/ledger/FX change):
 *   1. Logical order is ALWAYS  عدد → فاصله → نماد کوتاه ارز
 *      (e.g. «۱۵٬۹۵۷ $», never «$ ۱۵٬۹۵۷»).
 *   2. The unit is an ULTRA-SHORT symbol so it never overflows a card or a
 *      table column: IRT→ت, IRR→ر, USD→$, USDT→₮. USD/USDT never conflated.
 *   3. No Latin digits; the full Persian word stays available through
 *      `currencyLabel()` / `formatMoneyLong()` for labels & tooltips.
 *   4. Persian thousand separator «٬» everywhere.
 *   5. The string is wrapped in Unicode bidi isolates (RLI…PDI) so the
 *      number-first order survives even inside dir="ltr" containers.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  currencyLabel,
  currencySymbol,
  faCount,
  formatDualMoneyFromIrt,
  formatDualMoneyFromUsd,
  formatMoney,
  formatMoneyCompact,
  formatMoneyLong,
} from "../src/lib/format";

const RLI = "\u2067";
const PDI = "\u2069";
const money = (v: string | number, c?: string) => formatMoney(v, c);

test("canonical amounts from the product spec render number-first", () => {
  assert.equal(money("3000000000", "IRT"), `${RLI}۳٬۰۰۰٬۰۰۰٬۰۰۰\u00A0ت${PDI}`);
  assert.equal(money("15957", "USD"), `${RLI}۱۵٬۹۵۷\u00A0$${PDI}`);
  assert.equal(money("15957", "USDT"), `${RLI}۱۵٬۹۵۷\u00A0₮${PDI}`);
});

test("zeros keep the same number-first order", () => {
  assert.equal(money(0, "IRT"), `${RLI}۰\u00A0ت${PDI}`);
  assert.equal(money(0, "USD"), `${RLI}۰\u00A0$${PDI}`);
  assert.equal(money(0, "USDT"), `${RLI}۰\u00A0₮${PDI}`);
});

test("USD and USDT stay fully separate denominations", () => {
  assert.notEqual(money("15957", "USD"), money("15957", "USDT"));
  assert.ok(money("15957", "USDT").includes("₮"));
  assert.ok(!money("15957", "USDT").includes("$"));
  assert.ok(money("15957", "USD").includes("$"));
  // full words remain reachable for labels / tooltips
  assert.ok(formatMoneyLong("15957", "USDT").includes("تتر"));
  assert.ok(formatMoneyLong("15957", "USD").includes("دلار"));
  assert.ok(formatMoneyLong("3000000000", "IRT").includes("تومان"));
});

test("never shows Latin digits or a raw ticker code, and the unit stays ultra-short", () => {
  for (const [v, c] of [["15957", "USD"], ["15957", "USDT"], ["3000000000", "IRT"]] as const) {
    const out = money(v, c);
    assert.ok(!/[0-9]/.test(out), `no Latin digits in ${out}`);
    assert.ok(!/(USD|USDT|IRT)/.test(out.replace(RLI, "").replace(PDI, "")), `no raw code in ${out}`);
    const unit = out.replace(RLI, "").replace(PDI, "").split("\u00A0")[1];
    assert.ok(unit.length === 1, `unit «${unit}» must be a single glyph so it never overflows a card`);
  }
});

test("compact money keeps huge Toman figures inside their column", () => {
  assert.equal(formatMoneyCompact("4670288949", "IRT"), `${RLI}۴٫۶۷\u00A0میلیارد\u00A0ت${PDI}`);
  assert.equal(formatMoneyCompact("25000000000", "IRT"), `${RLI}۲۵\u00A0میلیارد\u00A0ت${PDI}`);
  assert.equal(formatMoneyCompact("-8500000", "IRT"), `${RLI}−۸٫۵\u00A0میلیون\u00A0ت${PDI}`);
  // below one million the exact grouped figure is kept
  assert.equal(formatMoneyCompact("850000", "IRT"), `${RLI}۸۵۰٬۰۰۰\u00A0ت${PDI}`);
});

test("currency order is always number → space → unit (unit never precedes)", () => {
  const out = money("15957", "USD").replace(RLI, "").replace(PDI, "");
  assert.ok(out.startsWith("۱۵٬۹۵۷"));
  assert.ok(out.endsWith("$"));
  assert.equal(out, "۱۵٬۹۵۷\u00A0$");
});

test("money strings carry bidi isolation so dir=\"ltr\" wrappers cannot flip the order", () => {
  const out = money("15957", "USD");
  assert.ok(out.startsWith(RLI) && out.endsWith(PDI), "wrapped in RLI…PDI");
});

test("currencySymbol is the ultra-short unit used by every money string", () => {
  assert.equal(currencySymbol("IRT"), "ت");
  assert.equal(currencySymbol("IRR"), "ر");
  assert.equal(currencySymbol("USD"), "$");
  assert.equal(currencySymbol("usdt"), "₮");
  assert.equal(currencySymbol("ETH"), "ETH");
  assert.equal(currencySymbol(null), "");
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
  assert.equal(dual.irt, `${RLI}۳٬۰۰۰٬۰۰۰٬۰۰۰\u00A0ت${PDI}`);
  assert.equal(dual.usd, `${RLI}۱۵٬۰۰۰\u00A0$${PDI}`);

  const fromUsd = formatDualMoneyFromUsd("15957", "200000");
  assert.equal(fromUsd.usd, `${RLI}۱۵٬۹۵۷\u00A0$${PDI}`);
  assert.ok(fromUsd.irt.includes("ت"));
});

test("faCount renders UI counts in Persian digits", () => {
  assert.equal(faCount(3), "۳");
  assert.equal(faCount(12), "۱۲");
  assert.equal(faCount("0"), "۰");
});
