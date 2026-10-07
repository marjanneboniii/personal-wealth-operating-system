import assert from "node:assert/strict";
import { mock, test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { smsConnectionConfig } from "../src/features/bankImport/connectionConfig";
mock.module("next/navigation", { namedExports: { useRouter: () => ({ refresh() {} }) } });

const key = Buffer.alloc(32, 7).toString("base64");
test("SMS availability reports missing HTTPS or encryption before issuing a key", () => {
  assert.equal(smsConnectionConfig("http://example.test", key).endpoint, null);
  assert.ok(smsConnectionConfig("https://example.test", "").unavailableReason);
  assert.ok(smsConnectionConfig("https://example.test", "invalid").unavailableReason);
  assert.ok(smsConnectionConfig("https://user:pass@example.test", key).unavailableReason);
  assert.deepEqual(smsConnectionConfig("https://example.test/path", key), { endpoint: "https://example.test/api/bank-messages", unavailableReason: null });
});

test("a generated key never presents the iPhone as having received a message", async () => {
  const { default: Connection } = await import("../src/components/transactions/IphoneSmsConnection");
  const props = { endpoint: "https://example.test/api/bank-messages", connections: [{ id: "device", name: "آیفون", createdAt: new Date().toISOString(), lastReceivedAt: null }] };
  const waiting = renderToStaticMarkup(createElement(Connection, props));
  assert.ok(waiting.includes("کلید آماده؛ منتظر پیام"));
  assert.ok(!waiting.includes("دریافت پیام تأیید شد"));
  assert.ok(waiting.includes("بررسی دریافت پیام"));
  const received = renderToStaticMarkup(createElement(Connection, { ...props, connections: [{ ...props.connections[0], lastReceivedAt: new Date().toISOString() }] }));
  assert.ok(received.includes("دریافت پیام تأیید شد"));
});

test("setup preview is usable before credentials and only explains later activation", async () => {
  const { default: Guide } = await import("../src/components/transactions/IphoneSmsGuide");
  const html = renderToStaticMarkup(createElement(Guide, { preview: true }));
  assert.ok(html.includes("پیش‌نمایش مراحل آیفون"));
  assert.ok(html.includes("Run Immediately"));
  assert.ok(html.includes("هر دو شرط"));
  assert.ok(!html.includes("tzsms_"));
});
