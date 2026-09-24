-- بیمه‌نامه‌ها: one row per policy term. Premiums are planned outflows linked
-- by planned_transactions.insurance_policy_id (forecast + reminders); paying
-- one is an ordinary expense — or, for a life policy with a cash value, a
-- transfer into its own savings account (savings_account_id).
CREATE TABLE IF NOT EXISTS public.insurance_policies (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz,
 user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
 kind text NOT NULL CHECK (kind IN ('third_party','car_body','fire','life','health','travel','liability','other')),
 title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 120),
 insurer text CHECK (char_length(insurer) <= 80),
 policy_number text CHECK (char_length(policy_number) <= 60),
 start_date date NOT NULL,
 end_date date CHECK (end_date IS NULL OR end_date > start_date),
 premium_toman numeric(38,18) NOT NULL CHECK (premium_toman > 0),
 premium_frequency text NOT NULL CHECK (premium_frequency IN ('once','monthly','quarterly','annual')),
 pay_account_id uuid NOT NULL REFERENCES public.accounts(id),
 coverage_toman numeric(38,18) CHECK (coverage_toman IS NULL OR coverage_toman > 0),
 insured_property_id uuid REFERENCES public.real_estate_properties(id) ON DELETE SET NULL,
 insured_vehicle_id uuid REFERENCES public.vehicle_assets(id) ON DELETE SET NULL,
 savings_account_id uuid REFERENCES public.accounts(id),
 status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','renewed','cancelled')),
 renewed_from_id uuid REFERENCES public.insurance_policies(id) ON DELETE SET NULL,
 closed_at timestamptz,
 note text CHECK (char_length(note) <= 500)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS insurance_policies_user_idx ON public.insurance_policies(user_id, status);
--> statement-breakpoint
ALTER TABLE public.planned_transactions ADD COLUMN IF NOT EXISTS insurance_policy_id uuid REFERENCES public.insurance_policies(id) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE public.insurance_policies ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON public.insurance_policies FROM PUBLIC;
--> statement-breakpoint
DO $$ DECLARE role_name text; BEGIN
 FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
   EXECUTE format('REVOKE ALL ON public.insurance_policies FROM %I', role_name);
  END IF;
 END LOOP;
END $$;
