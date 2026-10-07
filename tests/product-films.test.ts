import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ProductFilms from "../src/components/landing/ProductFilms";
import { PRODUCT_FILM_CHAPTERS, PRODUCT_FILM_DURATION, PRODUCT_PREVIEW_CHAPTERS, PRODUCT_PREVIEW_DURATION } from "../src/lib/productFilms";

test("public tour contains only the 20-second demo", () => {
  const html = renderToStaticMarkup(createElement(ProductFilms));
  assert.equal((html.match(/<video\b/g) ?? []).length, 1);
  assert.ok(html.includes('/videos/tavazon/preview.mp4'));
  assert.ok(!html.includes('/videos/tavazon/pwa.mp4'));
  assert.ok(!html.includes('/videos/tavazon/web.mp4'));
  assert.ok(!html.includes('aria-label="مرحله‌های راهنمای کامل"'));
  assert.ok(!html.includes("راهنمای کامل گوشی و وب"));
  assert.ok(!html.includes("۴۰ ثانیه"));
  assert.doesNotMatch(html, /<details/);
  assert.ok(html.includes('preload="none"'));
  assert.ok(!html.includes('autoPlay'));
  assert.ok(html.includes('href="/register"'));
  assert.ok(html.includes('preview.fa.vtt'));
  assert.ok(html.includes('نمای کلی'));
  assert.ok(html.indexOf('product-films-cta')<html.indexOf('product-films-everyday'));
  assert.match(html, /<video[^>]+controls/); // Native fallback before hydration.
});

test("short and complete captions have continuous timelines and contain daily budgets", () => {
  for (const [chapters, duration] of [[PRODUCT_PREVIEW_CHAPTERS, PRODUCT_PREVIEW_DURATION], [PRODUCT_FILM_CHAPTERS, PRODUCT_FILM_DURATION]] as const) {
    let end = 0;
    for (const chapter of chapters) {
      assert.equal(chapter.at, end, chapter.title);
      assert.ok(chapter.duration > 0);
      end += chapter.duration;
    }
    assert.equal(end, duration);
    assert.ok(chapters.some(c => c.scene === "budget"));
    assert.equal(chapters.at(-1)?.scene, "portfolio");
  }
  assert.equal(PRODUCT_PREVIEW_CHAPTERS[0].scene, "overview");
  assert.equal(PRODUCT_FILM_CHAPTERS[0].scene, "start");
});
