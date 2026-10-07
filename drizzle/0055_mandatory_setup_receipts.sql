CREATE TABLE IF NOT EXISTS setup_sessions (
 user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
 draft_encrypted text, progress jsonb NOT NULL DEFAULT '{}'::jsonb,
 lease_token uuid, lease_until timestamptz, updated_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE setup_sessions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN REVOKE ALL ON setup_sessions FROM anon; END IF;
 IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN REVOKE ALL ON setup_sessions FROM authenticated; END IF;
END $$;

--> statement-breakpoint
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS bank_details_encrypted text;
--> statement-breakpoint
ALTER TABLE deposits ADD COLUMN IF NOT EXISTS restricts_account_balance boolean NOT NULL DEFAULT false;

--> statement-breakpoint
ALTER TABLE lots ADD COLUMN IF NOT EXISTS purchase_fx_rate numeric(38,18);
