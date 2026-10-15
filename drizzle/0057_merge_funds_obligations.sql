-- One table per idea:
--   funds        → goals (kind = emergency | reserve | family_support)
--   obligations  → planned_transactions (an outflow, same date, amount and recurrence)
-- Rows keep their ids. Planning only: no account, entry or posting is touched.
ALTER TABLE public.goals ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'goal';
--> statement-breakpoint
DO $$ BEGIN
 IF to_regclass('public.funds') IS NOT NULL THEN
  INSERT INTO public.goals (id, created_at, updated_at, deleted_at, user_id, name, description, target_base, fund_account_id, kind)
  SELECT id, created_at, updated_at, deleted_at, user_id, name, note, target_base, account_id,
         CASE WHEN kind IN ('emergency','reserve','family_support') THEN kind ELSE 'reserve' END
  FROM public.funds
  ON CONFLICT (id) DO NOTHING;
  DROP TABLE public.funds;
 END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 IF to_regclass('public.obligations') IS NOT NULL THEN
  INSERT INTO public.planned_transactions (id, created_at, updated_at, deleted_at, user_id, title, planned_date, direction, amount_base, recurrence, status, note)
  SELECT id, created_at, updated_at, deleted_at, user_id, title, due_date, 'outflow', amount_base,
         CASE WHEN recurrence IN ('monthly','yearly') THEN recurrence ELSE 'none' END,
         CASE WHEN status = 'pending' THEN 'pending' WHEN status = 'cancelled' THEN 'cancelled' ELSE 'executed' END,
         note
  FROM public.obligations
  ON CONFLICT (id) DO NOTHING;
  DROP TABLE public.obligations;
 END IF;
END $$;
