/**
 * سوابق پیش از توازن — the story before the app, and ONLY before it.
 *
 * Pins three rules:
 *   1. a history record never touches the ledger (no entry, no posting, no
 *      balance moves) — the opening balances already hold its result;
 *   2. a record dated on or after «آغاز توازن» (or today / the future) is
 *      refused — the present goes through «ثبت تراکنش»;
 *   3. records are per user: another tenant can neither list, edit nor delete.
 */
import assert from "node:assert/strict";
import { test, mock } from "node:test";
import { eq } from "drizzle-orm";

const cookieJar: { value: string | null } = { value: null };
mock.module("next/headers", {
  namedExports: {
    cookies: async () => ({
      get: (name: string) =>
        name === "pwos_session" && cookieJar.value ? { value: cookieJar.value } : undefined,
      set: () => {},
      delete: () => {},
    }),
    headers: async () => new Headers(),
  },
});
mock.module("next/cache", { namedExports: { revalidatePath: () => {} } });

let db: any, createSchemaIfNotExists: any, createSession: any, schema: any;
let svc: any, actions: any;

const ready = (async () => {
  ({ db } = await import("../src/db"));
  ({ createSchemaIfNotExists } = await import("../src/db/init-schema"));
  ({ createSession } = await import("../src/lib/auth"));
  schema = await import("../src/db/schema");
  svc = await import("../src/features/history/service");
  actions = await import("../src/app/actions/history");
})();

async function makeUser(name: string) {
  const [user] = await db
    .insert(schema.users)
    .values({ name, username: name.toLowerCase(), role: "owner" } as any)
    .returning();
  return user;
}

function fd(values: Record<string, string>) {
  const f = new FormData();
  for (const [k, v] of Object.entries(values)) f.set(k, v);
  return f;
}

test("setup", async () => {
  await ready;
  await createSchemaIfNotExists();
  await db.delete(schema.historyRecords);
  await db.delete(schema.postings);
  await db.delete(schema.journalEntries);
});

test("a history record is saved without touching the ledger", async () => {
  await ready;
  const user = await makeUser("HistOwner");
  // توازن began for this user on 2026-03-01 (their first recorded entry).
  await db.insert(schema.journalEntries).values({
    userId: user.id,
    entryDate: "2026-03-01",
    type: "opening",
    description: "موجودی اولیه",
  } as any);
  assert.equal(await svc.getTavazonStart(user.id), "2026-03-01");

  const entriesBefore = await db.select().from(schema.journalEntries);
  const postingsBefore = await db.select().from(schema.postings);

  const { token } = await createSession(user.id);
  cookieJar.value = token;
  const res = await actions.saveHistoryRecordAction(
    null,
    fd({ kind: "buy", title: "خرید پراید", amount: "۲۵۰٬۰۰۰٬۰۰۰", unit: "IRT", occurredOn: "2019-05-10", accountLabel: "بانک ملت" }),
  );
  assert.equal(res.ok, true, res.message);

  const rows = await svc.listHistoryRecords(user.id);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].amount, "250000000", "Persian digits and separators are normalised");
  assert.equal(rows[0].accountLabel, "بانک ملت");

  assert.equal((await db.select().from(schema.journalEntries)).length, entriesBefore.length, "no journal entry");
  assert.equal((await db.select().from(schema.postings)).length, postingsBefore.length, "no posting");
});

test("a record on or after «آغاز توازن» is refused — it belongs to «ثبت تراکنش»", async () => {
  await ready;
  const [user] = await db.select().from(schema.users).where(eq(schema.users.name, "HistOwner"));
  for (const occurredOn of ["2026-03-01", "2026-04-15", "2099-01-01"]) {
    const res = await actions.saveHistoryRecordAction(null, fd({ kind: "expense", title: "خرید", amount: "1000", occurredOn }));
    assert.equal(res.ok, false, occurredOn);
    assert.match(res.message, /ثبت تراکنش/);
  }
  const ok = await actions.saveHistoryRecordAction(null, fd({ kind: "income", title: "حقوق اسفند", amount: "40000000", occurredOn: "2026-02-28" }));
  assert.equal(ok.ok, true, "the day before the start is still the past");
  assert.equal((await svc.listHistoryRecords(user.id)).length, 2);
});

test("with no transaction yet, today and the future are refused", async () => {
  await ready;
  const fresh = await makeUser("HistFresh");
  const today = new Date().toISOString().slice(0, 10);
  await assert.rejects(
    svc.createHistoryRecord(fresh.id, { kind: "expense", title: "امروز", amount: "10", occurredOn: today }),
    /اولین تراکنش ثبت‌شده/,
  );
  const past = await svc.createHistoryRecord(fresh.id, { kind: "expense", title: "دیروز", amount: "10", occurredOn: "2020-01-01" });
  assert.ok(past.id);
});

test("the summary adds Toman records only, by direction", async () => {
  await ready;
  const [user] = await db.select().from(schema.users).where(eq(schema.users.name, "HistOwner"));
  await svc.createHistoryRecord(user.id, { kind: "sell", title: "فروش دلار", amount: "500", unit: "USD", occurredOn: "2024-01-01" });
  const s = svc.summarizeHistory(await svc.listHistoryRecords(user.id));
  assert.equal(s.count, 3);
  assert.equal(s.inToman, "40000000", "the USD sale is never converted into the Toman total");
  assert.equal(s.outToman, "250000000");
  assert.equal(s.first, "2019-05-10");
  assert.equal(s.last, "2026-02-28");
});

test("another user can neither see, edit nor delete the records", async () => {
  await ready;
  const [owner] = await db.select().from(schema.users).where(eq(schema.users.name, "HistOwner"));
  const intruder = await makeUser("HistIntruder");
  const [target] = await svc.listHistoryRecords(owner.id);

  assert.equal((await svc.listHistoryRecords(intruder.id)).length, 0);

  const { token } = await createSession(intruder.id);
  cookieJar.value = token;
  const edit = await actions.saveHistoryRecordAction(
    null,
    fd({ id: target.id, kind: "other", title: "دستکاری", amount: "1", occurredOn: "2020-01-01" }),
  );
  assert.equal(edit.ok, false);
  const del = await actions.deleteHistoryRecordAction(target.id);
  assert.equal(del.ok, false);

  const [still] = await db.select().from(schema.historyRecords).where(eq(schema.historyRecords.id, target.id));
  assert.equal(still.title, target.title, "the owner's record is untouched");
});

test("the owner can edit and delete", async () => {
  await ready;
  const [owner] = await db.select().from(schema.users).where(eq(schema.users.name, "HistOwner"));
  const { token } = await createSession(owner.id);
  cookieJar.value = token;
  const [target] = await svc.listHistoryRecords(owner.id);
  const edit = await actions.saveHistoryRecordAction(
    null,
    fd({ id: target.id, kind: target.kind, title: "ویرایش‌شده", amount: target.amount, occurredOn: target.occurredOn }),
  );
  assert.equal(edit.ok, true, edit.message);
  const del = await actions.deleteHistoryRecordAction(target.id);
  assert.equal(del.ok, true, del.message);
  assert.equal((await svc.listHistoryRecords(owner.id)).length, 2);
});
