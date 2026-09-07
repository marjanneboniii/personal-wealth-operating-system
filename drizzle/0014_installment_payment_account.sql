-- 0014_installment_payment_account.sql
-- DATA MIGRATION — no schema change.
--
-- WHY: a repayment of a PLANNING-ONLY debt (every debt created in «بدهی‌ها»,
-- because `createDebtAction` leaves `account_id` NULL until a real movement
-- happens) has no liability account to reduce, so its debit leg needs a home.
-- It used to land on 5900 «هزینه متفرقه» — the classification audit of
-- 2026-09-07 (docs/AUDIT-INSTALLMENT-PAYMENT-CLASSIFICATION-2026-09-07.md,
-- finding F-3) recorded that this turned 5900 into a repayment grab-bag that no
-- budget or expense report can interpret.
--
-- This migration guarantees, for every tenant that owns accounts, a dedicated
-- expense-typed chart row 5960 «پرداخت اقساط» BEFORE the first payment, so it
-- can also be selected as the account of a budget that deliberately caps
-- installment outflow:
--   • a soft-deleted 5960 is revived rather than duplicated,
--   • a missing 5960 is created, denominated in the USD base asset,
--   • on legacy single-tenant databases (no tenant owns any row) a single
--     shared/global 5960 is created so anonymous-mode installs keep working.
-- Idempotent and conflict-tolerant; safe to re-run. Touches only the `accounts`
-- table: no postings, no lots, no journal entries, no balance is recalculated.
-- Existing history is left EXACTLY as it was recorded — a repayment already
-- booked on 5900 is not moved (the ledger is append-only); the reports and
-- budget read paths classify by ENTRY TYPE, so they are correct either way.

-- (a) revive an archived installment bucket (keeps its history attached to the
--     row that already has it).
update "accounts"
   set "deleted_at" = null,
       "is_active" = true,
       "updated_at" = now()
 where "code" = '5960'
   and "type" = 'expense'
   and "deleted_at" is not null;--> statement-breakpoint

-- (b) provision 5960 for each tenant that owns accounts but has none.
insert into "accounts" ("user_id", "code", "name", "type", "asset_id", "is_active", "created_at", "updated_at")
select t."user_id",
       '5960',
       'پرداخت اقساط',
       'expense',
       (select a."id" from "assets" a where a."symbol" = 'USD' and a."deleted_at" is null order by a."created_at" limit 1),
       true,
       now(),
       now()
  from (select distinct "user_id" from "accounts" where "user_id" is not null) t
 where not exists (
         select 1 from "accounts" x where x."user_id" = t."user_id" and x."code" = '5960'
       )
on conflict ("user_id", "code") do nothing;--> statement-breakpoint

-- (c) legacy single-tenant databases: no tenant-owned 5960 anywhere → one
--     shared global row, matching the seeded chart.
insert into "accounts" ("user_id", "code", "name", "type", "asset_id", "is_active", "created_at", "updated_at")
select null,
       '5960',
       'پرداخت اقساط',
       'expense',
       (select a."id" from "assets" a where a."symbol" = 'USD' and a."deleted_at" is null order by a."created_at" limit 1),
       true,
       now(),
       now()
 where not exists (select 1 from "accounts" x where x."code" = '5960')
on conflict ("user_id", "code") do nothing;
