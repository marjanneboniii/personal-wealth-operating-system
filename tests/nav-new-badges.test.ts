/**
 * «جدید» badges: few, temporary, and gone once seen.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { ALL_NAV_ITEMS, MAX_NEW_BADGES, NEW_BADGE_DAYS, newNavHrefs } from "../src/lib/nav";

test("new destinations: within the window, unvisited, capped", () => {
  const dated = ALL_NAV_ITEMS.filter((i) => i.since);
  assert.ok(dated.length > MAX_NEW_BADGES, "there are more new pages than badges allowed");
  const release = dated[0].since!;
  const fresh = newNavHrefs(release, new Set());
  assert.equal(fresh.length, MAX_NEW_BADGES, "never more than the cap");
  const next = newNavHrefs(release, new Set([fresh[0]]));
  assert.ok(!next.includes(fresh[0]), "a visited page loses its badge");
  assert.equal(next.length, MAX_NEW_BADGES, "and the next new page takes the slot");
  const later = new Date(`${release}T00:00:00Z`);
  later.setUTCDate(later.getUTCDate() + NEW_BADGE_DAYS + 1);
  assert.deepEqual(newNavHrefs(later.toISOString().slice(0, 10), new Set()), [], "after the window, nothing is new");
  const before = new Date(`${release}T00:00:00Z`);
  before.setUTCDate(before.getUTCDate() - 1);
  assert.deepEqual(newNavHrefs(before.toISOString().slice(0, 10), new Set()), [], "not before its release");
});
