-- Trigger functions do not need to be directly callable through the Data API.
-- PostgreSQL grants EXECUTE to PUBLIC for new functions by default, so revoke
-- that implicit privilege from the profile sync trigger explicitly.
REVOKE ALL ON FUNCTION public.sync_auth_user_profile() FROM PUBLIC, anon, authenticated;--> statement-breakpoint

-- Supabase's optional "automatic RLS" setting installs this event-trigger
-- function. Keep the migration portable to projects where the option is off,
-- while ensuring it cannot be invoked directly by Data API roles when present.
DO $$
BEGIN
  IF to_regprocedure('public.rls_auto_enable()') IS NOT NULL THEN
    EXECUTE 'REVOKE ALL ON FUNCTION public.rls_auto_enable() FROM PUBLIC, anon, authenticated';
  END IF;
END $$;
