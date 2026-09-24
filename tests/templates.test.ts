/**
 * تکرار و میان‌بر — record a familiar transaction again, never automatically.
 *
 *  • a posted expense / income / transfer of this user yields its values; a voided
 *    entry or another tenant's entry yields nothing
 *  • a shortcut stores that shape (optionally without the amount), is capped,
 *    and is deleted only by its owner
 *  • /new opens pre-filled from a repeat or a shortcut — the user still confirms
 *  • the quick actions follow what the user records most
 */
import assert from "node:assert/strict";
import { test, mock } from "node:test";
import { createElement } from "react";
import { accounts, assetClasses, assets, users, userFxSettings } from "../src/db/schema";

let cookie: string | null = null;
mock.module("next/headers", { namedExports: { cookies: async () => ({ get: () => (cookie ? { value: cookie } : undefined), set: () => {}, delete: () => {} }), headers: async () => new Headers() } });
mock.module("next/cache", { namedExports: { revalidatePath: () => {} } });
// /new refreshes the coin-network catalogue in the background; that is CoinGecko, not this feature.
mock.module("@/features/trade/networkSync", { namedExports: { ensureCryptoNetworks: async () => {}, getCryptoNetworks: async () => ({}), getCryptoNetworksOf: async () => null, refreshCryptoNetworks: async () => ({ synced: 0, status: "fresh" }) } });
mock.module("next/navigation", {
  namedExports: {
    redirect: (url: string) => {
      throw new Error(`NEXT_REDIRECT:${url}`);
    },
    useRouter: () => ({ replace: () => {}, push: () => {}, refresh: () => {} }),
    useSearchParams: () => new URLSearchParams(),
    usePathname: () => "/new",
  },
});

test("repeat and shortcuts", async () => {
  const { db } = await import("../src/db");
  const { createSchemaIfNotExists } = await import("../src/db/init-schema");
  const { createSession } = await import("../src/lib/auth");
  const { ensureCategoryCatalog, listCategoryTree } = await import("../src/features/categories/service");
  const { createTransactionAction, reverseEntryAction } = await import("../src/app/actions");
  const { entryPrefill, listTemplates, quickActionUsage, MAX_TEMPLATES } = await import("../src/features/templates/service");
  const { saveTemplateAction, deleteTemplateAction } = await import("../src/app/actions/templates");
  await createSchemaIfNotExists();
  await ensureCategoryCatalog();

  const mk = async (name: string) => {
    const [u] = await db.insert(users).values({ name, username: `${name}-${Math.random().toString(36).slice(2, 8)}`, role: "user" } as any).returning();
    await db.insert(userFxSettings).values({ userId: u.id, currentRate: "100000" } as any);
    return u;
  };
  const owner = await mk("repeater");
  const other = await mk("stranger");
  const [cash] = await db.insert(assetClasses).values({ code: "cash", name: "نقد" } as any).returning();
  await db.insert(assets).values({ symbol: "USD", name: "دلار", classId: cash.id, decimals: 2 } as any);
  const [irt] = await db.insert(assets).values({ symbol: "IRT", name: "تومان", classId: cash.id, decimals: 0 } as any).returning();
  const [bank] = await db.insert(accounts).values({ userId: owner.id, code: "1010", name: "بانک ملت", type: "asset", assetId: irt.id } as any).returning();
  const [bank2] = await db.insert(accounts).values({ userId: owner.id, code: "1020", name: "بانک سامان", type: "asset", assetId: irt.id } as any).returning();
  for (const u of [owner, other]) {
    await db.insert(accounts).values({ userId: u.id, code: "5900", name: "هزینه", type: "expense", assetId: irt.id } as any);
    await db.insert(accounts).values({ userId: u.id, code: "4010", name: "درآمد", type: "income", assetId: irt.id } as any);
  }
  const leaf = (await listCategoryTree(owner.id)).flatMap((g) => g.children).find((c) => c.code === "FOD-GROCERY-HOME")!;
  const incomeLeaf = (await listCategoryTree(owner.id, "income")).flatMap((g) => g.children)[0];
  cookie = (await createSession(owner.id)).token;
  const today = new Date().toISOString().slice(0, 10);
  const post = async (fields: Record<string, string>) => {
    const fd = new FormData();
    for (const [k, v] of Object.entries({ entryDate: today, ...fields })) fd.set(k, v);
    const r = await createTransactionAction(null, fd);
    assert.equal(r.ok, true, r.message);
    const [row] = (await db.execute(`select id from journal_entries order by created_at desc limit 1` as any)).rows as { id: string }[];
    return row.id;
  };
  const salary = await post({ type: "income", primaryAccountId: bank.id, categoryId: incomeLeaf.id, nativeAmount: "50000000", irtAmount: "50000000", description: "حقوق مهر" });
  const bread = await post({ type: "expense", primaryAccountId: bank.id, categoryId: leaf.id, irtAmount: "80000", description: "نان سنگک", tags: "#خانه" });
  const move = await post({ type: "transfer", primaryAccountId: bank.id, counterAccountId: bank2.id, irtAmount: "1000000", description: "انتقال به سامان" });

  assert.deepEqual(await entryPrefill(owner.id, bread), {
    type: "expense",
    accountId: bank.id,
    counterAccountId: null,
    categoryId: leaf.id,
    amountToman: "80000",
    description: "نان سنگک",
    tags: "#خانه",
  });
  const inc = (await entryPrefill(owner.id, salary))!;
  assert.equal(inc.type, "income");
  assert.equal(inc.accountId, bank.id, "income: the receiving account");
  assert.equal(inc.amountToman, "50000000");
  const tr = (await entryPrefill(owner.id, move))!;
  assert.deepEqual([tr.type, tr.accountId, tr.counterAccountId, tr.categoryId], ["transfer", bank.id, bank2.id, null]);
  assert.equal(await entryPrefill(other.id, bread), null, "another tenant's entry");

  // /new?repeat= opens the ordinary form, pre-filled.
  const { default: NewPage } = await import("../src/app/new/page");
  const { renderToReadableStream } = await import("react-dom/server");
  const stream = await renderToReadableStream(createElement(NewPage, { searchParams: Promise.resolve({ repeat: bread }) }));
  const html = await new Response(stream).text();
  assert.match(html, /نان سنگک/, "the description is pre-filled");
  assert.match(html, /#خانه/, "and the tags");

  // Shortcuts.
  assert.equal((await saveTemplateAction(bread, "نان", true)).ok, true);
  assert.equal((await saveTemplateAction(move, "", false)).ok, true);
  let list = await listTemplates(owner.id);
  assert.deepEqual(list.map((t) => [t.label, t.amountToman]), [["نان", "80000"], ["انتقال به سامان", null]], "label defaults to the description; amount can be left to ask");
  const stream2 = await renderToReadableStream(createElement(NewPage, { searchParams: Promise.resolve({ template: list[0].id }) }));
  assert.match(await new Response(stream2).text(), /نان سنگک/);

  cookie = (await createSession(other.id)).token;
  assert.equal((await saveTemplateAction(bread, "دزدی", true)).ok, false, "another tenant's entry cannot be saved");
  assert.equal((await deleteTemplateAction(list[0].id)).ok, false, "nor someone else's shortcut deleted");
  cookie = (await createSession(owner.id)).token;
  for (let i = list.length; i < MAX_TEMPLATES; i++) assert.equal((await saveTemplateAction(bread, `نان ${i}`, true)).ok, true);
  assert.equal((await saveTemplateAction(bread, "یکی بیشتر", true)).ok, false, "capped");
  assert.equal((await deleteTemplateAction(list[0].id)).ok, true);
  list = await listTemplates(owner.id);
  assert.equal(list.length, MAX_TEMPLATES - 1);

  // A voided entry is not offered again.
  assert.equal((await reverseEntryAction(bread)).ok, true);
  assert.equal(await entryPrefill(owner.id, bread), null);

  const usage = await quickActionUsage(owner.id);
  assert.equal(usage.income, 1);
  assert.equal(usage.transfer, 1);
});
