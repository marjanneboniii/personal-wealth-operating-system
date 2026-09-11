/**
 * The onboarding checklist's decision logic.
 *
 * These tests pin the thing the checklist exists for: telling «I own no
 * property» apart from «I never reached the property question», and turning
 * that difference into a reminder aimed at one person instead of a banner
 * shown to everybody.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ASSET_CATEGORIES,
  CATEGORY_META,
  REMINDER_DELAY_DAYS,
  evaluateChecklist,
  isAssetCategory,
  pendingReminders,
  type AssetCategory,
  type IntentRow,
} from "../src/features/onboarding/categories";

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date("2026-09-11T09:00:00.000Z");

function intent(
  category: AssetCategory,
  answer: "yes" | "no",
  daysAgo = 0,
  over: Partial<IntentRow> = {},
): IntentRow {
  return {
    category,
    answer,
    answeredAt: new Date(NOW.getTime() - daysAgo * DAY).toISOString(),
    itemsAtAnswer: 0,
    reminderDismissedAt: null,
    ...over,
  };
}

const allAnswered = (answer: "yes" | "no" = "no") =>
  ASSET_CATEGORIES.map((c) => intent(c, answer));

test("every category the brief lists is asked about, in Persian", () => {
  assert.deepEqual([...ASSET_CATEGORIES], [
    "real_estate",
    "vehicle",
    "crypto",
    "fund",
    "online_gold",
    "stock",
  ]);
  for (const category of ASSET_CATEGORIES) {
    const meta = CATEGORY_META[category];
    assert.ok(meta, `${category} has no metadata`);
    // A question about the user's own life, not a feature pitch.
    assert.ok(meta.question.endsWith("؟"), `${category} prompt is not a question`);
    assert.ok(/[؀-ۿ]/.test(meta.label), `${category} label is not Persian`);
    assert.ok(/[؀-ۿ]/.test(meta.hint), `${category} hint is not Persian`);
    assert.ok(meta.href.startsWith("/"), `${category} has no destination`);
  }
  assert.equal(isAssetCategory("vehicle"), true);
  assert.equal(isAssetCategory("yacht"), false);
});

test("an unanswered category is not the same as a «نه»", () => {
  // The whole point. Silence means the checklist is unfinished; «نه» means the
  // user told us there is nothing there, and both must be distinguishable.
  const silent = evaluateChecklist([], {});
  assert.deepEqual(silent.unanswered, [...ASSET_CATEGORIES]);
  assert.equal(silent.complete, false);
  assert.deepEqual(silent.promisedButEmpty, []);

  const declined = evaluateChecklist(allAnswered("no"), {});
  assert.deepEqual(declined.unanswered, []);
  assert.equal(declined.complete, true);
  assert.deepEqual(
    declined.promisedButEmpty,
    [],
    "saying «نه» to everything is a complete, valid answer — not a gap",
  );
});

test("«بله» with nothing registered is the gap worth surfacing", () => {
  const intents = [
    intent("crypto", "yes"),
    intent("real_estate", "yes"),
    intent("vehicle", "no"),
  ];
  const status = evaluateChecklist(intents, { real_estate: 2 });

  // Said yes to property AND registered two — nothing to chase.
  assert.equal(status.promisedButEmpty.includes("real_estate"), false);
  // Said yes to crypto and registered none — this is the one.
  assert.deepEqual(status.promisedButEmpty, ["crypto"]);
  // Three categories were never asked, so the checklist is not finished.
  assert.equal(status.complete, false);
  assert.deepEqual(status.unanswered, ["fund", "online_gold", "stock"]);
});

test("the reminder waits out a grace period", () => {
  const counts = {};
  // An hour after saying «بله», a nudge is noise — they may be mid-flow.
  const fresh = [intent("crypto", "yes", 0)];
  assert.deepEqual(pendingReminders(fresh, counts, NOW), []);

  const almost = [intent("crypto", "yes", REMINDER_DELAY_DAYS - 1)];
  assert.deepEqual(pendingReminders(almost, counts, NOW), []);

  const due = [intent("crypto", "yes", REMINDER_DELAY_DAYS)];
  assert.deepEqual(pendingReminders(due, counts, NOW), ["crypto"]);
});

test("the reminder targets the mismatch, never everybody", () => {
  const intents = [
    intent("crypto", "yes", 10),
    intent("vehicle", "yes", 10),
    intent("stock", "no", 10),
    intent("fund", "yes", 10),
  ];
  const counts = { vehicle: 1, fund: 3 };

  // Only the category that was promised and is still empty.
  assert.deepEqual(pendingReminders(intents, counts, NOW), ["crypto"]);
});

test("a dismissed reminder stays dismissed without changing the answer", () => {
  const intents = [
    intent("crypto", "yes", 10, {
      reminderDismissedAt: new Date(NOW.getTime() - DAY).toISOString(),
    }),
  ];
  assert.deepEqual(pendingReminders(intents, {}, NOW), []);
  // The claim itself survives — the user still says they hold crypto.
  assert.equal(intents[0].answer, "yes");
  assert.deepEqual(evaluateChecklist(intents, {}).promisedButEmpty, []);
});

test("registering the asset later silences the reminder on its own", () => {
  const intents = [intent("crypto", "yes", 30)];
  assert.deepEqual(pendingReminders(intents, {}, NOW), ["crypto"]);
  assert.deepEqual(
    pendingReminders(intents, { crypto: 1 }, NOW),
    [],
    "no dismissal needed — the gap closed",
  );
});

test("a completed checklist can still have a gap", () => {
  // Answering all six is not the same as having entered everything, which is
  // exactly why the review screen asks again before locking.
  const intents = ASSET_CATEGORIES.map((c) => intent(c, c === "stock" ? "yes" : "no", 5));
  const status = evaluateChecklist(intents, {});
  assert.equal(status.complete, true);
  assert.deepEqual(status.promisedButEmpty, ["stock"]);
});
