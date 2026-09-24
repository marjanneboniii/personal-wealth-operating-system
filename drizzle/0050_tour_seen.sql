-- The one-time guided tour after setup: remembered per ACCOUNT, not per device,
-- so an installed PWA (its own storage) does not show it again.
ALTER TABLE public.user_preferences ADD COLUMN IF NOT EXISTS tour_seen_at timestamptz;
