-- 0028_category_catalog_dedupe.sql
--
-- The shared category catalogue was seeded with a check-then-insert and no
-- lock. Two concurrent requests could both seed it, so every group and source
-- (e.g. «حقوق و دستمزد») appeared twice in the income and expense pickers.
--
-- Keeps the oldest live system row per (kind, code), re-points every reference
-- (entries, recurring incomes, sub-categories) to it, removes the copies, and
-- adds a unique index so the catalogue cannot be seeded twice again.
-- User-created categories are untouched.

UPDATE "journal_entries" je SET "category_id" = d.keep_id
  FROM (
    SELECT id, first_value(id) OVER (PARTITION BY kind, code ORDER BY created_at, id) AS keep_id
      FROM "expense_categories" WHERE user_id IS NULL AND deleted_at IS NULL
  ) d
 WHERE je.category_id = d.id AND d.id <> d.keep_id;--> statement-breakpoint
UPDATE "planned_transactions" pt SET "category_id" = d.keep_id
  FROM (
    SELECT id, first_value(id) OVER (PARTITION BY kind, code ORDER BY created_at, id) AS keep_id
      FROM "expense_categories" WHERE user_id IS NULL AND deleted_at IS NULL
  ) d
 WHERE pt.category_id = d.id AND d.id <> d.keep_id;--> statement-breakpoint
UPDATE "expense_categories" c SET "parent_id" = d.keep_id
  FROM (
    SELECT id, first_value(id) OVER (PARTITION BY kind, code ORDER BY created_at, id) AS keep_id
      FROM "expense_categories" WHERE user_id IS NULL AND deleted_at IS NULL
  ) d
 WHERE c.parent_id = d.id AND d.id <> d.keep_id;--> statement-breakpoint
DELETE FROM "expense_categories" c
 USING (
    SELECT id, first_value(id) OVER (PARTITION BY kind, code ORDER BY created_at, id) AS keep_id
      FROM "expense_categories" WHERE user_id IS NULL AND deleted_at IS NULL
  ) d
 WHERE c.id = d.id AND d.id <> d.keep_id;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "expense_categories_system_code_uq" ON "expense_categories" USING btree ("code") WHERE "user_id" IS NULL AND "deleted_at" IS NULL;
