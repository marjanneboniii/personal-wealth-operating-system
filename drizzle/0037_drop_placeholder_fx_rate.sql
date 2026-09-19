-- Sign-up used to write a placeholder rate (190,000 IRT/USD) into
-- user_fx_settings for every new user. Once stored it was indistinguishable
-- from a rate the user actually had, so a transaction booked before the first
-- market refresh froze it into its permanent FX snapshot.
--
-- Delete exactly those rows: the default value, never updated since it was
-- written (last_updated_at is null — a market refresh or a manual update
-- always sets it). A user with no row falls back to the display-only rate,
-- which every write now refuses until a real rate arrives.
DELETE FROM user_fx_settings
 WHERE last_updated_at IS NULL
   AND current_rate = 190000;--> statement-breakpoint

-- No new placeholder can be created by omission.
ALTER TABLE user_fx_settings ALTER COLUMN current_rate DROP DEFAULT;
