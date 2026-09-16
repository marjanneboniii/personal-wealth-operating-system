CREATE TABLE public.bank_sms_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  name text NOT NULL,
  token_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  last_received_at timestamptz
);
--> statement-breakpoint
CREATE UNIQUE INDEX bank_sms_connections_token_idx ON public.bank_sms_connections(token_hash);
--> statement-breakpoint
CREATE INDEX bank_sms_connections_user_idx ON public.bank_sms_connections(user_id);
--> statement-breakpoint
CREATE TABLE public.bank_sms_inbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  connection_id uuid NOT NULL REFERENCES public.bank_sms_connections(id),
  encrypted_payload text,
  fingerprint text NOT NULL,
  sent_at timestamptz NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','confirmed','rejected')),
  processing_at timestamptz,
  entry_id uuid REFERENCES public.journal_entries(id)
);
--> statement-breakpoint
CREATE UNIQUE INDEX bank_sms_inbox_replay_idx ON public.bank_sms_inbox(user_id,fingerprint);
--> statement-breakpoint
CREATE INDEX bank_sms_inbox_user_status_idx ON public.bank_sms_inbox(user_id,status);
--> statement-breakpoint
CREATE INDEX bank_sms_inbox_connection_idx ON public.bank_sms_inbox(connection_id);
--> statement-breakpoint
-- Only trusted application server connections may access credentials or SMS.
ALTER TABLE public.bank_sms_connections ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.bank_sms_inbox ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON public.bank_sms_connections, public.bank_sms_inbox FROM PUBLIC;
--> statement-breakpoint
DO $$ DECLARE role_name text; BEGIN
  FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
      EXECUTE format('REVOKE ALL ON public.bank_sms_connections, public.bank_sms_inbox FROM %I', role_name);
    END IF;
  END LOOP;
END $$;
