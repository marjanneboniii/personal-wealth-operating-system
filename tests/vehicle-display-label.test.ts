/**
 * Short vehicle labels for list surfaces.
 *
 * The stored `assets.name` stays «{brand} {model} ({manufacturing year})» —
 * this only governs what a LIST shows. The two reductions and the reasons for
 * them are documented in src/features/rwa/vehicle/display.ts.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { vehicleDisplayLabel } from "../src/features/rwa/vehicle/display";

test("the manufacturing year is dropped from the list label", () => {
  assert.equal(vehicleDisplayLabel("تویوتا کرولا (2020)"), "تویوتا کرولا");
  assert.equal(vehicleDisplayLabel("کیا اسپورتیج (۲۰۱۹)"), "کیا اسپورتیج");
  // Both digit systems, and with or without a space before the bracket.
  assert.equal(vehicleDisplayLabel("مزدا 3 (1399)"), "مزدا 3");
  assert.equal(vehicleDisplayLabel("نیسان قشقایی(۱۴۰۱)"), "نیسان قشقایی");
});

test("a domestic assembler prefix is dropped — the model already names the marque", () => {
  assert.equal(
    vehicleDisplayLabel("ایران‌خودرو پژو 207 اتوماتیک TU5p سقف فلزی (1402)"),
    "پژو 207 اتوماتیک TU5p سقف فلزی",
  );
  assert.equal(vehicleDisplayLabel("سایپا اطلس E اتوماتیک (۱۴۰۳)"), "اطلس E اتوماتیک");
  assert.equal(vehicleDisplayLabel("بهمن موتور فیدلیتی پرایم (۱۴۰۲)"), "فیدلیتی پرایم");
  assert.equal(vehicleDisplayLabel("کرمان موتور جک J4 (1399)"), "جک J4");
});

test("an imported brand IS the marque, so it stays", () => {
  assert.equal(vehicleDisplayLabel("تویوتا کرولا (2020)"), "تویوتا کرولا");
  assert.equal(vehicleDisplayLabel("مرسدس بنز C200 (2021)"), "مرسدس بنز C200");
  assert.equal(vehicleDisplayLabel("هیوندای توسان (2018)"), "هیوندای توسان");
});

test("the model's own spelling survives — ZWNJ is never flattened to a space", () => {
  // Folding (ZWNJ → space, ي → ی) is for MATCHING the brand only. Returning
  // the folded text would ship «دنده ای» and «دوگانه سوز» to the user.
  const dena = vehicleDisplayLabel("ایران‌خودرو دنا پلاس MT6 دنده‌ای (۱۴۰۱)");
  assert.equal(dena, "دنا پلاس MT6 دنده‌ای");
  assert.ok(dena.includes("‌"), "the ZWNJ in «دنده‌ای» is preserved");

  const saina = vehicleDisplayLabel("سایپا ساینا GXL دوگانه‌سوز (1400)");
  assert.equal(saina, "ساینا GXL دوگانه‌سوز");
  assert.ok(saina.includes("‌"), "the ZWNJ in «دوگانه‌سوز» is preserved");
});

test("a brand written with a space instead of a ZWNJ still matches", () => {
  // «ایران‌خودرو» and «ایران خودرو» are the same brand to a user.
  assert.equal(vehicleDisplayLabel("ایران خودرو تارا V1 (1402)"), "تارا V1");
  assert.equal(vehicleDisplayLabel("ایران‌خودرو تارا V1 (1402)"), "تارا V1");
});

test("anything that is not a catalogue vehicle name passes through untouched", () => {
  // A mixed asset table applies this to every row, so non-vehicles must be safe.
  for (const name of ["اتریوم", "تومان", "آپارتمان ۹۵ متری سعادت‌آباد", "طلای ۱۸ عیار", ""]) {
    assert.equal(vehicleDisplayLabel(name), name);
  }
  assert.equal(vehicleDisplayLabel(null), "");
  assert.equal(vehicleDisplayLabel(undefined), "");
  // A year-like bracket on a NON-vehicle is not a year and must not be eaten.
  assert.equal(vehicleDisplayLabel("صندوق طلا (1403)"), "صندوق طلا (1403)");
});

test("the label never collapses to nothing", () => {
  // A vehicle whose model name is somehow missing keeps the brand rather than
  // rendering an empty row.
  assert.equal(vehicleDisplayLabel("سایپا"), "سایپا");
  assert.equal(vehicleDisplayLabel("سایپا (1400)"), "سایپا");
});
