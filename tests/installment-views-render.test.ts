import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import InstallmentViews from "../src/components/planning/InstallmentViews";

test("both financial views remain in server markup; paid access precedes content", () => {
  const html = renderToStaticMarkup(createElement(InstallmentViews, { pendingCount: 2, paidCount: 1, pending: "PENDING-ROWS", paid: "PAID-SNAPSHOT" }));
  assert.ok(html.includes("PENDING-ROWS") && html.includes("PAID-SNAPSHOT"));
  assert.ok(html.indexOf("پرداخت‌شده") < html.indexOf("PENDING-ROWS"));
  assert.match(html, /role="tabpanel"[^>]*hidden=""[^>]*>PAID-SNAPSHOT/);
  assert.match(html, /role="tab"[^>]*aria-selected="true"[^>]*>.*?پیش‌رو/);
});

test("the paid view opens automatically when all installments are paid", () => {
  const html = renderToStaticMarkup(createElement(InstallmentViews, { pendingCount: 0, paidCount: 3, pending: "EMPTY-PENDING", paid: "PAID-SNAPSHOT" }));
  assert.match(html, /role="tabpanel"[^>]*hidden=""[^>]*>EMPTY-PENDING/);
  assert.match(html, /role="tabpanel"(?![^>]*hidden)[^>]*>PAID-SNAPSHOT/);
});
