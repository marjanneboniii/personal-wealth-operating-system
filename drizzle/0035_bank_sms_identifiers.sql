CREATE TABLE public.bank_sms_identifiers (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
 account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
 bank_name text NOT NULL,
 kind text NOT NULL CHECK (kind IN ('card','account','iban')),
 suffix text NOT NULL CHECK (suffix ~ '^[0-9]{4,8}$'),
 created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX bank_sms_identifiers_unique_idx ON public.bank_sms_identifiers(user_id,account_id,bank_name,kind,suffix);
--> statement-breakpoint
CREATE INDEX bank_sms_identifiers_user_idx ON public.bank_sms_identifiers(user_id);
--> statement-breakpoint
ALTER TABLE public.bank_sms_identifiers ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON public.bank_sms_identifiers FROM PUBLIC;
--> statement-breakpoint
DO $$ DECLARE role_name text; BEGIN
 FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
   EXECUTE format('REVOKE ALL ON public.bank_sms_identifiers FROM %I', role_name);
  END IF;
 END LOOP;
END $$;
