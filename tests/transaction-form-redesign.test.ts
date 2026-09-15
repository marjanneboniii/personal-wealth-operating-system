/**
 * ثبت تراکنش — the redesign's rules, pinned against regressions.
 *
 * The form is a client component with a server action behind it, so these are
 * source-level assertions on the rules that matter — the same approach the
 * other UI contract tests in this repo take.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const FORM = read("src/components/forms/TransactionForm.tsx");
/** Rendered code only — comments removed. */
const CODE = FORM.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/^\s*\/\/.*$/gm, "");

test("no CoinGecko notice, no exchange name, anywhere in the form", () => {
  assert.doesNotMatch(CODE, /CoinGecko|COINGECKO_API_KEY|api\.coingecko\.com|فهرست آفلاین|به‌روزرسانی کاتالوگ/);
  assert.doesNotMatch(CODE, /والکس|آبان[\s‌]?تتر/);
});

test("accounts are shown by name, never by ledger code", () => {
  assert.doesNotMatch(CODE, /\{a\.code\}\s*—/, "the old «code — name» option label is gone");
  assert.doesNotMatch(CODE, /\.code \?\? ""/, "no account-code chip in the summary");
  assert.match(CODE, /function accountLabel/);
});

test("the server contract is unchanged — every field is still posted", () => {
  for (const name of [
    "type",
    "irtAmount",
    "amount",
    "categoryId",
    "primaryAccountId",
    "counterAccountId",
    "quantity",
    "fee",
    "feeMode",
    "description",
    "fxRate",
    "fxRateDate",
    "debtId",
    "installmentId",
    "settleQuantity",
    "unitPrice",
    "priceMode",
    "nativeAmount",
    "recurring",
    "planId",
  ]) {
    assert.match(CODE, new RegExp(`name="${name}"`), name);
  }
  assert.match(CODE, /name="entryDate"/, "the date input still posts entryDate");
});

test("a transfer can never target its own source account", () => {
  assert.match(CODE, /toOptions = assetAccounts\.filter\(\(a\) => a\.id !== fromId\)/);
});

test("the fee is shown in the unit of the paying account, not always Toman", () => {
  assert.match(CODE, /formatMoney\(fee, feeInToman \? "IRT" : feeSymbol\)/);
  assert.doesNotMatch(CODE, /formatMoney\(fee, "IRT"\)/);
});

test("a description is filled in automatically; the user is never forced to type one", () => {
  assert.match(CODE, /finalDescription = description\.trim\(\) \|\| autoDescription/);
  assert.match(CODE, /name="description" value=\{finalDescription\}/);
  assert.doesNotMatch(CODE, /name="description"\s+required/);
});

test("the submit button says exactly what is missing", () => {
  assert.match(CODE, /باقی مانده: \{missing\.join/);
});

test("nothing is written before the final confirm", () => {
  const submits = CODE.match(/type="submit"/g) ?? [];
  assert.equal(submits.length, 1, "one submit button");
  const confirm = CODE.indexOf('type="submit"');
  const review = CODE.indexOf("بررسی قبل از ثبت");
  assert.ok(review >= 0 && review < confirm, "the only submit sits inside the review card");
});

test("every number in the form goes through the shared numeric field", () => {
  assert.doesNotMatch(CODE, /replace\(\/\[\^0-9/, "no hand-rolled digit stripping");
  assert.doesNotMatch(CODE, /inputMode="decimal"\s*\n\s*className="field num"\s*\n\s*dir="ltr"\s*\n\s*placeholder="0\.00000000"/);
  // Toman amounts are typed in the repayment and transfer cards, through the same field.
  assert.match(read("src/components/forms/DebtRepaymentFields.tsx"), /<AmountInput[\s\S]*?onValueChange=\{p\.setAmount\}/);
  assert.match(read("src/components/forms/TransferFields.tsx"), /<AmountInput[\s\S]*?onValueChange=\{p\.setAmount\}/);
  // Quantities are typed in the trade and transfer cards, through the same field.
  assert.match(read("src/components/forms/TradeFields.tsx"), /<AmountInput[\s\S]*?onValueChange=\{p\.setQuantity\}/);
  assert.match(read("src/components/forms/TransferFields.tsx"), /<AmountInput[\s\S]*?onValueChange=\{p\.setQuantity\}/);
});

test("no plain numeric <input> is left anywhere in the app", () => {
  const files = [
    "src/app/setup/page.tsx",
    "src/components/forms/DebtForm.tsx",
    "src/components/setup/SetupDebtsStep.tsx",
    "src/components/setup/SetupRealAssetsStep.tsx",
    "src/components/setup/SetupInstrumentsStep.tsx",
    "src/components/registry/realestate/RealEstateForm.tsx",
    "src/components/registry/realestate/RealEstateCard.tsx",
    "src/components/registry/vehicle/VehicleCard.tsx",
    "src/components/registry/vehicle/VehicleForm.tsx",
    "src/components/registry/vehicle/CatalogAdmin.tsx",
  ];
  for (const file of files) {
    const src = read(file);
    const plain = [...src.matchAll(/<input\b[^>]*>/g)].map((m) => m[0]).filter((tag) => /inputMode=/.test(tag));
    assert.deepEqual(plain, [], `${file} still has a plain numeric <input>`);
    assert.doesNotMatch(src, /<input\s*\n(\s+[^\n>]*\n)*?\s+inputMode="(numeric|decimal)"/, `${file}: multi-line numeric <input>`);
  }
});

test("the server reads Persian digits in amounts as the same number", () => {
  const actions = read("src/app/actions.ts");
  assert.match(actions, /for \(const key of \["irtAmount", "amount", "quantity", "fee", "fxRate"\]\)/);
  assert.match(actions, /normalizeNumericInput\(raw\[key\]/);
});
