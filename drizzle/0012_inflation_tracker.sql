-- 0012_inflation_tracker.sql
-- PERSONAL-INFLATION TRACKER — additive, non-destructive, NO accounting impact.
--
-- WHY: grocery/consumable price tracking («ردیاب تورم شخصی») was rendered
-- inside the Real-Assets workspace (`/asset-registry`), which wrongly implied
-- consumables are wealth. The tracker becomes an independent module with:
--   • per-tenant ownership (`user_id`, NULL = shared/global legacy row),
--   • an optional free-text «منطقه یا شهر» (`region`) per price observation,
--   • a seeded catalog of suggested Persian categories (shared rows).
--
-- SAFETY:
--   • No table is dropped, renamed or truncated; no row is deleted.
--   • Existing rows keep `user_id = NULL` and stay readable by every tenant
--     (shared baseline) — the service layer scopes reads to (owner OR shared).
--   • The legacy global UNIQUE(name) is replaced by two PARTIAL uniques that
--     preserve the old dedupe for shared rows while allowing two tenants to
--     own the same label. Both old constraint names (drizzle-generated and
--     raw-SQL `..._key`) are dropped defensively with IF EXISTS.
--   • Touches ONLY the three `commodity_*` tables. No journal, posting, lot,
--     account, asset, price, snapshot or valuation table is referenced here.
-- Idempotent; safe to re-run.

-- (a) per-tenant ownership ------------------------------------------------
alter table "commodity_categories" add column "user_id" uuid;--> statement-breakpoint
alter table "commodity_items" add column "user_id" uuid;--> statement-breakpoint
alter table "commodity_price_records" add column "user_id" uuid;--> statement-breakpoint
alter table "commodity_price_records" add column "region" text;--> statement-breakpoint

-- (b) retire the global UNIQUE(name) — both historical constraint names -----
alter table "commodity_categories" drop constraint if exists "commodity_categories_name_unique";--> statement-breakpoint
alter table "commodity_categories" drop constraint if exists "commodity_categories_name_key";--> statement-breakpoint
drop index if exists "commodity_categories_name_unique";--> statement-breakpoint
alter table "commodity_items" drop constraint if exists "commodity_items_name_unique";--> statement-breakpoint
alter table "commodity_items" drop constraint if exists "commodity_items_name_key";--> statement-breakpoint
drop index if exists "commodity_items_name_unique";--> statement-breakpoint

-- (c) tenant foreign keys (nullable → existing rows untouched) ---------------
alter table "commodity_categories" add constraint "commodity_categories_user_id_users_id_fk" foreign key ("user_id") references "public"."users"("id") on delete cascade on update no action;--> statement-breakpoint
alter table "commodity_items" add constraint "commodity_items_user_id_users_id_fk" foreign key ("user_id") references "public"."users"("id") on delete cascade on update no action;--> statement-breakpoint
alter table "commodity_price_records" add constraint "commodity_price_records_user_id_users_id_fk" foreign key ("user_id") references "public"."users"("id") on delete cascade on update no action;--> statement-breakpoint

-- (d) partial uniques: shared rows dedupe by name, tenant rows by (owner, name)
create unique index if not exists "commodity_categories_shared_name_uq" on "commodity_categories" using btree ("name") where "user_id" is null;--> statement-breakpoint
create unique index if not exists "commodity_categories_user_name_uq" on "commodity_categories" using btree ("user_id","name") where "user_id" is not null;--> statement-breakpoint
create unique index if not exists "commodity_items_shared_name_uq" on "commodity_items" using btree ("name") where "user_id" is null;--> statement-breakpoint
create unique index if not exists "commodity_items_user_name_uq" on "commodity_items" using btree ("user_id","name") where "user_id" is not null;--> statement-breakpoint

-- (e) tenant lookup indexes --------------------------------------------------
create index if not exists "commodity_categories_user_idx" on "commodity_categories" using btree ("user_id");--> statement-breakpoint
create index if not exists "commodity_items_user_idx" on "commodity_items" using btree ("user_id");--> statement-breakpoint
create index if not exists "commodity_price_user_idx" on "commodity_price_records" using btree ("user_id");--> statement-breakpoint

-- (f) suggested Persian category catalog (shared rows, insert-if-missing) ----
insert into "commodity_categories" ("user_id", "name")
select null, c.name
  from (values ('مواد غذایی'), ('پروتئین'), ('لبنیات'), ('حبوبات'), ('نان و غلات'), ('روغن'), ('شوینده و بهداشتی'), ('سایر')) as c(name)
 where not exists (select 1 from "commodity_categories" x where x."name" = c.name and x."user_id" is null);
