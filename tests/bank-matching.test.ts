import assert from "node:assert/strict";
import { test } from "node:test";
import { matchBankAccount, type BankIdentifier } from "../src/features/bankImport/matching";
const identifiers: BankIdentifier[] = [
 { id: "1", accountId: "mellat", bankName: "ملت", kind: "card", suffix: "1234" },
 { id: "2", accountId: "melli", bankName: "ملی ایران", kind: "card", suffix: "1234" },
 { id: "3", accountId: "mellat", bankName: "ملت", kind: "card", suffix: "5678" },
];
test("bank and labelled suffix distinguish identical card endings across banks", () => {
 assert.equal(matchBankAccount("بانک ملت کارت: 6037****۱۲۳۴ برداشت: 200 تومان", identifiers).accountId, "mellat");
 assert.equal(matchBankAccount("بانک ملی ایران کارت: ****1234", identifiers).accountId, "melli");
 assert.equal(matchBankAccount("بانک ملت کارت: ****5678", identifiers).accountId, "mellat");
});
test("unknown bank, tracking number, balance and destination never select an account", () => {
 for (const source of ["کارت: ****1234", "بانک ملت پیگیری: 1234", "بانک ملت مانده: 1234", "بانک ملت به کارت: ****1234", "بانک ملت کارت مقصد: ****1234", "بانک ملت مقصد کارت: ****1234", "بانک ملت کارت: ****1234 بانک ملی ایران کارت: ****1234"]) assert.equal(matchBankAccount(source, identifiers).accountId, undefined, source);
});
test("same-bank suffix collisions and conflicting identifiers require manual review", () => {
 const colliding = [...identifiers, { id: "4", accountId: "another", bankName: "ملت", kind: "card", suffix: "1234" }];
 assert.equal(matchBankAccount("بانک ملت کارت: ****1234", colliding).accountId, undefined);
 assert.equal(matchBankAccount("بانک ملت کارت: ****1234 حساب: 9999", identifiers).accountId, undefined);
});
