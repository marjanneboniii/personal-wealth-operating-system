-- 0021_obligation_direction_and_partial.sql
-- ADDITIVE ONLY. No column is dropped, no row is rewritten, no journal entry
-- is touched, no balance is recalculated. Every existing debt keeps the exact
-- meaning it had before this ran.
--
-- WHY EACH COLUMN EXISTS
--
-- (1) debts.direction — «بدهی من» vs «طلب من».
--     The debt table already models everything a receivable needs (a
--     counterparty, a principal in Toman, a status, a schedule, a frozen FX
--     snapshot). The ONE thing it could not express is which way the money
--     flows at settlement, and that is not a caption: it is the sign of the
--     cash leg. Adding a direction column is strictly smaller — and far safer
--     — than a parallel `receivables` table that would have had to re-derive
--     the schedule, the FX freeze and the tenant scoping from scratch.
--
--     DEFAULT 'payable' is the whole backfill: every row that exists today was
--     created by «بدهی‌ها», which has only ever recorded money the user owes.
--     NOT NULL + CHECK makes an unknown direction unrepresentable, so no read
--     path has to guess.
--
-- (2) debts.schedule_kind — how the due dates of the schedule were produced
--     ('once' | 'recurring' | 'custom'), with (3) schedule_interval_months for
--     the recurring cadence. These are AUDIT/UX metadata, never money: the due
--     dates themselves live in `installments.due_date` and stay the source of
--     truth. They exist so the UI can tell «هر ۳ ماه» apart from a custom
--     schedule whose gaps happen to be 3 months — a distinction that cannot be
--     recovered from the dates once they are written.
--
--     'recurring' + interval 1 is the historical behaviour of every schedule
--     ever created (createDebtAction generated firstDueDate + N months), so
--     that is what existing rows are backfilled to. This records what actually
--     happened; it does not change a single due date.
--
-- (4) installments.paid_toman is REUSED, not replaced, as the running total
--     settled against a row. It was already written once, at full settlement.
--     A partial payment now accumulates into it and leaves the status at
--     'partial'. Because 'partial' is a NEW status value, no existing row can
--     be reinterpreted by it: every row in the database today is 'pending' or
--     'paid' and keeps its exact meaning.

-- (1) direction ---------------------------------------------------------
ALTER TABLE "debts" ADD COLUMN IF NOT EXISTS "direction" text NOT NULL DEFAULT 'payable';--> statement-breakpoint

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'debts_direction_check'
  ) THEN
    ALTER TABLE "debts"
      ADD CONSTRAINT "debts_direction_check"
      CHECK ("direction" IN ('payable', 'receivable'));
  END IF;
END $$;--> statement-breakpoint

-- Reads are almost always «all my debts» or «all my receivables» for ONE
-- tenant, so the direction rides along with the existing user index rather
-- than getting an index of its own.
CREATE INDEX IF NOT EXISTS "debts_user_direction_idx" ON "debts" ("user_id", "direction");--> statement-breakpoint

-- (2)(3) schedule provenance -------------------------------------------
ALTER TABLE "debts" ADD COLUMN IF NOT EXISTS "schedule_kind" text;--> statement-breakpoint
ALTER TABLE "debts" ADD COLUMN IF NOT EXISTS "schedule_interval_months" integer;--> statement-breakpoint

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'debts_schedule_kind_check'
  ) THEN
    ALTER TABLE "debts"
      ADD CONSTRAINT "debts_schedule_kind_check"
      CHECK ("schedule_kind" IS NULL OR "schedule_kind" IN ('once', 'recurring', 'custom'));
  END IF;
END $$;--> statement-breakpoint

-- Backfill: record what the old generator actually did. A debt WITH a
-- schedule was always monthly-recurring; a debt without one has no schedule
-- kind at all and stays NULL.
UPDATE "debts" d
   SET "schedule_kind" = 'recurring',
       "schedule_interval_months" = 1
 WHERE d."schedule_kind" IS NULL
   AND EXISTS (SELECT 1 FROM "installments" i WHERE i."debt_id" = d."id");--> statement-breakpoint

-- (4) partial settlement -----------------------------------------------
-- `paid_toman` already exists (added in the Phase-5 FX freeze). Only the
-- status vocabulary widens, and only forward: nothing is migrated INTO
-- 'partial'.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'installments_status_check'
  ) THEN
    ALTER TABLE "installments"
      ADD CONSTRAINT "installments_status_check"
      CHECK ("status" IN ('pending', 'partial', 'paid'));
  END IF;
END $$;--> statement-breakpoint

-- An installment must never outlive its parent obligation, and must never be
-- created without one (brief §18: «قسط دوم نمی‌تواند بدون parent obligation
-- ثبت شود»). The FK + ON DELETE CASCADE already in the table enforces this;
-- this index is what makes the per-obligation schedule read cheap now that
-- every debt card resolves its own installments.
CREATE INDEX IF NOT EXISTS "installments_debt_seq_idx" ON "installments" ("debt_id", "seq");
