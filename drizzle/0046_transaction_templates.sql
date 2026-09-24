-- میان‌برهای ثبت: a saved shape of a transaction the user records often.
-- Presentation only — a template never posts; it pre-fills the form, which
-- the user still reviews and confirms.
CREATE TABLE IF NOT EXISTS public.transaction_templates (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 created_at timestamptz NOT NULL DEFAULT now(),
 user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
 label text NOT NULL CHECK (char_length(label) BETWEEN 1 AND 40),
 type text NOT NULL CHECK (type IN ('expense','income','transfer')),
 account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
 counter_account_id uuid REFERENCES public.accounts(id) ON DELETE CASCADE,
 category_id uuid REFERENCES public.expense_categories(id) ON DELETE SET NULL,
 amount_toman numeric(38,18) CHECK (amount_toman IS NULL OR amount_toman > 0),
 description text NOT NULL CHECK (char_length(description) BETWEEN 1 AND 200),
 tags text CHECK (char_length(tags) <= 200)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS transaction_templates_user_idx ON public.transaction_templates(user_id, created_at);
--> statement-breakpoint
ALTER TABLE public.transaction_templates ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON public.transaction_templates FROM PUBLIC;
--> statement-breakpoint
DO $$ DECLARE role_name text; BEGIN
 FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
   EXECUTE format('REVOKE ALL ON public.transaction_templates FROM %I', role_name);
  END IF;
 END LOOP;
END $$;
