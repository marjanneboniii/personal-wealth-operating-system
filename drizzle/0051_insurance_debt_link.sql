-- بیمه‌نامه‌ها ← بدهی‌ها: a policy bought on installments is paid through its
-- debt's schedule (debt_id), not through premium reminders — so it needs no
-- paying account of its own and nothing is ever paid twice.
ALTER TABLE public.insurance_policies ADD COLUMN IF NOT EXISTS debt_id uuid REFERENCES public.debts(id) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE public.insurance_policies ALTER COLUMN pay_account_id DROP NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS insurance_policies_debt_active_idx ON public.insurance_policies(debt_id) WHERE debt_id IS NOT NULL AND status = 'active';
