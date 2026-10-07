import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { test } from "node:test";
import { SETUP_BANKS, isSuggestedBankAccountName, searchSetupBanks, suggestedBankAccountName } from "../src/features/setup/bankCatalog";
import { validateSetupBankAccounts } from "../src/features/setup/bankAccounts";

test("all 38 reference institutions have local logos and valid stored bank names, excluding Bitcoin", () => {
  assert.equal(SETUP_BANKS.length, 38);
  assert.equal(new Set(SETUP_BANKS.map((bank) => bank.value)).size, 38);
  assert.ok(!SETUP_BANKS.some((bank) => /bitcoin|بیت\s*کوین/i.test(bank.name)));
  for (const bank of SETUP_BANKS) {
    assert.ok(existsSync(`public${bank.logo}`), bank.name);
    assert.equal(validateSetupBankAccounts([{ name: bank.name, bankName: bank.value, balance: "0" }])[0].bankName, bank.value);
  }
});

test("bank search tolerates Persian and Arabic letters, spaces and half spaces", () => {
  assert.equal(searchSetupBanks("ملي")[0].name, "بانک ملی ایران");
  assert.equal(searchSetupBanks("قرض الحسنه").length, 2);
  assert.equal(searchSetupBanks("بلو بانک")[0].name, "بلوبانک");
  assert.equal(searchSetupBanks("ناشناخته").length, 0);
  assert.equal(searchSetupBanks("").length, 38);
});

test("automatic account names remain unique for multiple accounts at the same bank", () => {
  const bank = SETUP_BANKS.find((row) => row.value === "ملت")!;
  assert.equal(suggestedBankAccountName(bank, []), "بانک ملت");
  assert.equal(suggestedBankAccountName(bank, ["بانک ملت", "بانک ملت ۲"]), "بانک ملت 3");
  assert.equal(isSuggestedBankAccountName("بانک ملت ۲", bank), true);
  assert.equal(isSuggestedBankAccountName("بانک ملت پس‌انداز", bank), false);
  assert.doesNotThrow(() => validateSetupBankAccounts([bank.name, `${bank.name} 2`].map((name) => ({ name, bankName: bank.value, balance: "0" }))));
});
