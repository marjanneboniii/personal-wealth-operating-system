-- 0011_fee_expense_account.sql
-- DATA MIGRATION — no schema change.
--
-- WHY: the commission counter-leg of a BUY (account code 5040 «کارمزد و بانک»)
-- is resolved server-side by code. The seeded demo chart contains 5040, but the
-- chart created by the setup wizard (`completeSetup()`) did NOT, and neither did
-- any install created before this change. A buy with a commission on such a
-- database either (a) silently dropped the fee leg — producing the unbalanced
-- entry «سند تراز نیست. اختلاف در ارز پایه» — or (b) found SOME other user's
-- 5040 row and posted the fee into it (audit F-02 / F-03).
--
-- This migration guarantees, for every tenant that owns accounts:
--   • a soft-deleted 5040 is revived rather than duplicated,
--   • a missing 5040 is created, denominated in the USD base asset,
--   • on legacy single-tenant databases (no tenant owns any row) a single
--     shared/global 5040 is created so anonymous-mode installs keep working.
-- Idempotent and conflict-tolerant; safe to re-run. Touches only the
-- `accounts` table: no postings, no lots, no balances, no journal entries.

-- (a) revive an archived fee account (keeps its history attached to the row
--     that already has it, so the ledger stays append-only).
update "accounts"
   set "deleted_at" = null,
       "is_active" = true,
       "updated_at" = now()
 where "code" = '5040'
   and "type" = 'expense'
   and "deleted_at" is not null;--> statement-breakpoint

-- (b) provision 5040 for each tenant that owns accounts but has none.
insert into "accounts" ("user_id", "code", "name", "type", "asset_id", "is_active", "created_at", "updated_at")
select t."user_id",
       '5040',
       'کارمزد و بانک',
       'expense',
       (select a."id" from "assets" a where a."symbol" = 'USD' and a."deleted_at" is null order by a."created_at" limit 1),
       true,
       now(),
       now()
  from (select distinct "user_id" from "accounts" where "user_id" is not null) t
 where not exists (
         select 1 from "accounts" x where x."user_id" = t."user_id" and x."code" = '5040'
       )
on conflict ("user_id", "code") do nothing;--> statement-breakpoint

-- (c) legacy single-tenant databases: no tenant-owned 5040 anywhere → one
--     shared global row, matching the seeded chart.
insert into "accounts" ("user_id", "code", "name", "type", "asset_id", "is_active", "created_at", "updated_at")
select null,
       '5040',
       'کارمزد و بانک',
       'expense',
       (select a."id" from "assets" a where a."symbol" = 'USD' and a."deleted_at" is null order by a."created_at" limit 1),
       true,
       now(),
       now()
 where not exists (select 1 from "accounts" x where x."code" = '5040')
on conflict ("user_id", "code") do nothing;
