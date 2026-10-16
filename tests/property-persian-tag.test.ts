/**
 * اجاره و بازده — a property reads in Persian, and an old Latin tag
 * («shahrak_daneshgah») becomes Persian once without unlinking anything.
 *
 *  • the label comes from the neighbourhood and city catalogue («شهرک دانشگاه، اهواز»)
 *  • the stored tag and this user's tagged entries move to «شهرک_دانشگاه»
 *  • another user's entries with the same Latin tag are left alone
 */
import assert from "node:assert/strict";
import { test, mock } from "node:test";
import { assetClasses, assets, cities, entryTags, journalEntries, neighborhoods, realEstateProperties, users } from "../src/db/schema";

mock.module("next/cache", { namedExports: { revalidatePath: () => {} } });

test("a Latin property tag becomes Persian and keeps its entries", async () => {
  const { db } = await import("../src/db");
  const { eq } = await import("drizzle-orm");
  const { createSchemaIfNotExists } = await import("../src/db/init-schema");
  const { listPropertyEconomics } = await import("../src/features/properties/service");
  await createSchemaIfNotExists();

  const tag = Math.random().toString(36).slice(2, 7);
  const [u] = await db.insert(users).values({ name: "owner", username: `pt-${tag}`, role: "user" } as any).returning();
  const [o] = await db.insert(users).values({ name: "other", username: `pto-${tag}`, role: "user" } as any).returning();
  const [city] = await db.insert(cities).values({ nameFa: "اهواز", nameEn: "Ahvaz", code: `ahv-${tag}` } as any).returning();
  const [hood] = await db.insert(neighborhoods).values({ cityId: city.id, nameFa: "شهرک دانشگاه", nameEn: "Shahrak Daneshgah", code: `sd-${tag}` } as any).returning();
  const [cls] = await db.insert(assetClasses).values({ code: `re-${tag}`, name: "ملک" } as any).returning();
  const [a] = await db.insert(assets).values({ symbol: `P-${tag}`, name: "آپارتمان", classId: cls.id, decimals: 0 } as any).returning();
  const [home] = await db
    .insert(realEstateProperties)
    .values({ assetId: a.id, userId: u.id, area: "shahrak_daneshgah", city: "Ahvaz", cityId: city.id, neighborhoodId: hood.id, expenseTag: "shahrak_daneshgah", userSeq: 1 } as any)
    .returning();

  const entry = async (userId: string) => {
    const [je] = await db.insert(journalEntries).values({ entryDate: "2026-09-01", type: "expense", description: "شارژ", status: "posted", userId } as any).returning();
    await db.insert(entryTags).values({ entryId: je.id, tag: "shahrak_daneshgah" } as any);
    return je.id;
  };
  const mine = await entry(u.id);
  const theirs = await entry(o.id);

  const [p] = await listPropertyEconomics(u.id, "2026-10-16");
  assert.equal(p.label, "شهرک دانشگاه، اهواز", "the card reads in Persian");
  assert.equal(p.tag, "شهرک_دانشگاه", "the tag is Persian now");
  const [stored] = await db.select({ t: realEstateProperties.expenseTag }).from(realEstateProperties).where(eq(realEstateProperties.id, home.id));
  assert.equal(stored.t, "شهرک_دانشگاه", "the new tag is stored");
  const tagsOf = async (id: string) => (await db.select({ t: entryTags.tag }).from(entryTags).where(eq(entryTags.entryId, id))).map((r) => r.t);
  assert.deepEqual(await tagsOf(mine), ["شهرک_دانشگاه"], "this user's entry moves with the tag");
  assert.deepEqual(await tagsOf(theirs), ["shahrak_daneshgah"], "another user's entry is untouched");

  const [again] = await listPropertyEconomics(u.id, "2026-10-16");
  assert.equal(again.tag, "شهرک_دانشگاه", "renamed once, then stable");

  // Typed Latin area, no catalogue link: matched on the English name.
  const [u2] = await db.insert(users).values({ name: "typed", username: `pt2-${tag}`, role: "user" } as any).returning();
  const [a2] = await db.insert(assets).values({ symbol: `P2-${tag}`, name: "آپارتمان", classId: cls.id, decimals: 0 } as any).returning();
  await db.insert(realEstateProperties).values({ assetId: a2.id, userId: u2.id, area: "shahrak_daneshgah", city: "Ahvaz", expenseTag: "shahrak_daneshgah", userSeq: 1 } as any);
  const [typed] = await listPropertyEconomics(u2.id, "2026-10-16");
  assert.equal(typed.label, "شهرک دانشگاه، اهواز", "found by its English name");
  assert.equal(typed.tag, "شهرک_دانشگاه");
});
