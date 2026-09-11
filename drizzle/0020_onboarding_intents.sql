-- Onboarding checklist answers: one row per user per asset category.
--
-- STATEMENT DELIMITERS: the breakpoint markers at the end of each statement
-- below are not cosmetic. Drizzle's migrator sends everything between two of
-- them as ONE prepared statement, and PostgreSQL refuses a prepared statement
-- that contains several commands («cannot insert multiple commands into a
-- prepared statement»). Without them this file could never be applied at all —
-- which is why it carried no journal entry and the table it defines has never
-- reached a migrated database. Adding them changes no SQL; it only tells the
-- migrator where each statement ends.
--
-- (The marker token is deliberately not spelled out in this comment: the
-- splitter is a plain string search, so writing it here would split the file
-- mid-sentence.)
--
-- The table exists so the app can tell «has no property» apart from «forgot to
-- enter the property». Without a recorded negative answer there is nothing to
-- re-ask against, and the follow-up reminder degrades into a generic banner.

CREATE TABLE IF NOT EXISTS onboarding_intents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  category text NOT NULL,
  answer text NOT NULL,
  answered_at timestamptz NOT NULL DEFAULT now(),
  items_at_answer integer NOT NULL DEFAULT 0,
  reminder_dismissed_at timestamptz
);--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS onboarding_intents_user_category_uq
  ON onboarding_intents(user_id, category);--> statement-breakpoint

-- Same tenant isolation every other user-scoped table gets (see 0016).
-- A checklist answer is personal data: it states what a named person owns.
DO $$
BEGIN
  IF to_regclass('public.onboarding_intents') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE onboarding_intents ENABLE ROW LEVEL SECURITY';
    EXECUTE 'REVOKE ALL ON TABLE onboarding_intents FROM PUBLIC';
    EXECUTE 'DROP POLICY IF EXISTS tenant_select ON onboarding_intents';
    EXECUTE 'DROP POLICY IF EXISTS tenant_insert ON onboarding_intents';
    EXECUTE 'DROP POLICY IF EXISTS tenant_update ON onboarding_intents';
    EXECUTE 'DROP POLICY IF EXISTS tenant_delete ON onboarding_intents';
    EXECUTE 'CREATE POLICY tenant_select ON onboarding_intents FOR SELECT USING (user_id::text = nullif(current_setting(''app.user_id'', true), ''''))';
    EXECUTE 'CREATE POLICY tenant_insert ON onboarding_intents FOR INSERT WITH CHECK (user_id::text = nullif(current_setting(''app.user_id'', true), ''''))';
    EXECUTE 'CREATE POLICY tenant_update ON onboarding_intents FOR UPDATE USING (user_id::text = nullif(current_setting(''app.user_id'', true), '''')) WITH CHECK (user_id::text = nullif(current_setting(''app.user_id'', true), ''''))';
    EXECUTE 'CREATE POLICY tenant_delete ON onboarding_intents FOR DELETE USING (user_id::text = nullif(current_setting(''app.user_id'', true), ''''))';
  END IF;
END $$;
