-- 0027_income_redesign.sql
--
-- Income is classified like expenses: the same category tree gains a `kind`
-- (expense | income). Occupations order the income suggestions, and a recurring
-- income (salary, pension, rent) keeps its category, its amount in the
-- receiving account's own unit, and its day of month.
--
-- Additive: new nullable/defaulted columns; every existing category stays an
-- expense category. No ledger row is touched.

ALTER TABLE "expense_categories" ADD COLUMN IF NOT EXISTS "kind" text DEFAULT 'expense' NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "expense_categories_kind_idx" ON "expense_categories" USING btree ("kind");--> statement-breakpoint
ALTER TABLE "user_preferences" ADD COLUMN IF NOT EXISTS "occupations" text;--> statement-breakpoint
ALTER TABLE "planned_transactions" ADD COLUMN IF NOT EXISTS "category_id" uuid REFERENCES "expense_categories"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "planned_transactions" ADD COLUMN IF NOT EXISTS "amount_native" numeric(38, 18);--> statement-breakpoint
ALTER TABLE "planned_transactions" ADD COLUMN IF NOT EXISTS "day_of_month" integer;
