/**
 * هشتگ تراکنش — a reporting dimension beside the immutable ledger.
 *
 *  • one spelling per tag: «#سفر», «سفر» and an Arabic-keyboard «سفر» are the same tag
 *  • tags are saved with the entry, and can be changed after posting without touching postings
 *  • the list filters by tag; the tag total is all-time, posted-only, in frozen Toman
 *  • another tenant's entries can never be tagged, listed or summed
 */
import assert from "node:assert/strict";
import { test, mock } from "node:test";
import { eq, sql } from "drizzle-orm";
import { D } from "../src/domain/decimal";
import { accounts, assetClasses, assets, entryTags, journalEntries, postings, users, userFxSettings } from "../src/db/schema";
import { MAX_TAGS_PER_ENTRY, normalizeTag, parseTags } from "../src/features/tags/normalize";

const cookieJar: { value: string | null } = { value: null };
mock.module("next/headers", {
  namedExports: {
    cookies: async () => ({
      get: (name: string) => (name === "pwos_session" && cookieJar.value ? { value: cookieJar.value } : undefined),
      set: () => {},
      delete: () => {},
    }),
    headers: async () => new Headers(),
  },
});
mock.module("next/cache", { namedExports: { revalidatePath: () => {} } });

test("normalization: one spelling per tag", () => {
  assert.equal(normalizeTag("#سفر"), "سفر");
  assert.equal(normalizeTag("  سفر "), "سفر");
  assert.equal(normalizeTag("#سفري"), "سفری", "Arabic ي becomes Persian ی");
  assert.equal(normalizeTag("كيش"), "کیش");
  assert.equal(normalizeTag("سفر 1405"), "سفر_۱۴۰۵", "spaces join, digits are Persian");
  assert.equal(normalizeTag("سفر۱۴۰۵"), normalizeTag("سفر١٤٠٥"), "Arabic-Indic digits too");
  assert.equal(normalizeTag("Trip-2026!"), "trip-۲۰۲۶");
  assert.equal(normalizeTag("تعمیر‌خانه"), "تعمیر‌خانه", "ZWNJ is part of the word");
  assert.equal(normalizeTag("#"), null);
  assert.equal(normalizeTag("!!!"), null);
  assert.equal(Array.from(normalizeTag("ا".repeat(50))!).length, 32);
  assert.deepEqual(parseTags("#سفر #شمال، خانواده,#سفر"), ["سفر", "شمال", "خانواده"]);
  assert.deepEqual(parseTags(""), []);
});

let db: any, createSchemaIfNotExists: any, createSession: any, ensureCategoryCatalog: any, listCategoryTree: any;
let createTransactionAction: any, setEntryTagsAction: any, tagEntriesAction: any, reverseEntryAction: any;
let getTransactions: any, listTags: any, getTagSummary: any;

const modulesReady = (async () => {
  ({ db } = await import("../src/db"));
  ({ createSchemaIfNotExists } = await import("../src/db/init-schema"));
  ({ createSession } = await import("../src/lib/auth"));
  ({ createTransactionAction, setEntryTagsAction, tagEntriesAction, reverseEntryAction } = await import("../src/app/actions"));
  ({ ensureCategoryCatalog, listCategoryTree } = await import("../src/features/categories/service"));
  ({ getTransactions } = await import("../src/features/ledger/queries"));
  ({ listTags, getTagSummary } = await import("../src/features/tags/service"));
})();

const TODAY = "2026-09-14";

async function fixture() {
  await createSchemaIfNotExists();
  await ensureCategoryCatalog();
  const mk = async (name: string) => {
    const [u] = await db
      .insert(users)
      .values({ name, username: `${name}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, role: "owner" } as any)
      .returning();
    await db.insert(userFxSettings).values({ userId: u.id, currentRate: "100000" } as any);
    return u;
  };
  const owner = await mk("traveller");
  const other = await mk("neighbour");
  const [cash] = await db.insert(assetClasses).values({ code: "cash", name: "نقد و بانک" } as any).returning();
  await db.insert(assets).values({ symbol: "USD", name: "دلار", classId: cash.id, decimals: 2 } as any);
  const [irt] = await db.insert(assets).values({ symbol: "IRT", name: "تومان", classId: cash.id, decimals: 0 } as any).returning();
  const [bank] = await db.insert(accounts).values({ code: "1010", name: "بانک", type: "asset", assetId: irt.id, userId: owner.id } as any).returning();
  const [otherBank] = await db.insert(accounts).values({ code: "1010", name: "بانک دیگری", type: "asset", assetId: irt.id, userId: other.id } as any).returning();
  for (const u of [owner, other]) {
    await db.insert(accounts).values({ code: "5900", name: "هزینه", type: "expense", assetId: irt.id, userId: u.id } as any);
  }
  const leaf = (await listCategoryTree(owner.id)).flatMap((g: any) => g.children).find((c: any) => c.code === "FOD-GROCERY-HOME");
  return { owner, other, bank, otherBank, leaf };
}

const expense = (f: { bank: any; leaf: any }, fields: Record<string, string>) => {
  const fd = new FormData();
  fd.set("type", "expense");
  fd.set("entryDate", TODAY);
  fd.set("feeMode", "irt");
  fd.set("primaryAccountId", f.bank.id);
  fd.set("categoryId", f.leaf.id);
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
};

const entryByDescription = async (description: string) =>
  (await db.select().from(journalEntries).where(eq(journalEntries.description, description)))[0];

test("tags ride with the entry, filter the list, total in frozen Toman, and stay inside the tenant", async () => {
  await modulesReady;
  const f = await fixture();

  // Another tenant's tagged expense exists and must never be seen.
  cookieJar.value = (await createSession(f.other.id)).token;
  const foreign = await createTransactionAction(null, expense({ bank: f.otherBank, leaf: f.leaf }, { description: "هتل دیگری", irtAmount: "9000000", tags: "#سفر" }));
  assert.equal(foreign.ok, true, foreign.message);
  const foreignEntry = await entryByDescription("هتل دیگری");

  cookieJar.value = (await createSession(f.owner.id)).token;

  // Too many tags is refused before anything is written.
  const tooMany = Array.from({ length: MAX_TAGS_PER_ENTRY + 1 }, (_, i) => `#t${i}`).join(" ");
  const refused = await createTransactionAction(null, expense(f, { description: "رد شود", irtAmount: "1000", tags: tooMany }));
  assert.equal(refused.ok, false);
  assert.equal(await entryByDescription("رد شود"), undefined, "no entry without its tags");

  // ۱. Tags are saved with the entry, normalized.
  const hotel = await createTransactionAction(null, expense(f, { description: "هتل", irtAmount: "3000000", tags: "#سفر #شمال" }));
  assert.equal(hotel.ok, true, hotel.message);
  const food = await createTransactionAction(null, expense(f, { description: "رستوران", irtAmount: "1000000", tags: "سفري" }));
  assert.equal(food.ok, true, food.message);
  const plain = await createTransactionAction(null, expense(f, { description: "نان", irtAmount: "50000" }));
  assert.equal(plain.ok, true, plain.message);
  const hotelEntry = await entryByDescription("هتل");
  const foodEntry = await entryByDescription("رستوران");
  const plainEntry = await entryByDescription("نان");
  const tagsOf = async (id: string) =>
    (await db.select({ tag: entryTags.tag }).from(entryTags).where(eq(entryTags.entryId, id))).map((r: any) => r.tag).sort();
  assert.deepEqual(await tagsOf(hotelEntry.id), ["سفر", "شمال"]);
  assert.deepEqual(await tagsOf(foodEntry.id), ["سفری"], "a different word is a different tag");

  // ۲. Retagging after posting never touches the ledger.
  const postingsBefore = (await db.execute(sql`select count(*)::int as n, sum(base_value)::text as s from postings`)).rows[0];
  assert.equal((await setEntryTagsAction(foodEntry.id, "#سفر")).ok, true);
  assert.deepEqual(await tagsOf(foodEntry.id), ["سفر"]);
  const bulk = await tagEntriesAction([plainEntry.id, hotelEntry.id], "خانه");
  assert.equal(bulk.ok, true, bulk.message);
  assert.deepEqual(await tagsOf(hotelEntry.id), ["خانه", "سفر", "شمال"]);
  const postingsAfter = (await db.execute(sql`select count(*)::int as n, sum(base_value)::text as s from postings`)).rows[0];
  assert.deepEqual(postingsAfter, postingsBefore, "postings are untouched");

  // ۳. Another tenant's entry cannot be tagged, alone or inside a batch.
  assert.equal((await setEntryTagsAction(foreignEntry.id, "#مال_من")).ok, false);
  assert.equal((await tagEntriesAction([plainEntry.id, foreignEntry.id], "مال_من")).ok, false);
  assert.deepEqual(await tagsOf(foreignEntry.id), ["سفر"]);
  assert.deepEqual(await tagsOf(plainEntry.id), ["خانه"], "a denied batch writes nothing");

  // ۴. The list filters by tag and carries the tags; tenant-scoped.
  const trip = await getTransactions({ tag: "سفر", userId: f.owner.id });
  assert.deepEqual(trip.map((r: any) => r.description).sort(), ["رستوران", "هتل"]);
  assert.deepEqual(trip.find((r: any) => r.description === "هتل").tags, ["خانه", "سفر", "شمال"]);
  assert.deepEqual((await listTags(f.owner.id)).map((t: any) => [t.tag, t.entries]), [["خانه", 2], ["سفر", 2], ["شمال", 1]]);
  assert.deepEqual((await listTags(f.other.id)).map((t: any) => t.tag), ["سفر"]);

  // ۵. The tag total is the frozen Toman of posted entries only.
  let summary = await getTagSummary("#سفر", f.owner.id);
  assert.equal(summary.entries, 2);
  assert.equal(D(summary.expenseToman).toFixed(0), "4000000", "3,000,000 + 1,000,000 — the other tenant's 9,000,000 is not here");
  assert.equal(D(summary.expenseUsd).toFixed(2), "40.00");
  assert.equal(summary.expenseEntriesWithSnap, 2);
  assert.equal(summary.firstDate, TODAY);

  // A voided entry keeps its tags but leaves the total.
  const reversed = await reverseEntryAction(foodEntry.id);
  assert.equal(reversed.ok, true, reversed.message);
  summary = await getTagSummary("سفر", f.owner.id);
  assert.equal(summary.entries, 1);
  assert.equal(D(summary.expenseToman).toFixed(0), "3000000");
  assert.deepEqual(await tagsOf(foodEntry.id), ["سفر"]);

  // Deleting an entry (cascade) takes its tags with it.
  await db.delete(postings).where(eq(postings.entryId, plainEntry.id));
  await db.delete(journalEntries).where(eq(journalEntries.id, plainEntry.id));
  assert.deepEqual(await tagsOf(plainEntry.id), []);
});
