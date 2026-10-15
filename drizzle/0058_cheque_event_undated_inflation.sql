-- A cheque can pay part of an event; a Toman undated debt can carry an
-- estimated yearly inflation from its start date. Additive only.
ALTER TABLE public.cheques ADD COLUMN IF NOT EXISTS event_id uuid REFERENCES public.events(id) ON DELETE SET NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS cheques_event_idx ON public.cheques(event_id) WHERE event_id IS NOT NULL;
--> statement-breakpoint
ALTER TABLE public.undated_obligations ADD COLUMN IF NOT EXISTS start_date date;
--> statement-breakpoint
ALTER TABLE public.undated_obligations ADD COLUMN IF NOT EXISTS inflation_pct numeric(6,2) CHECK (inflation_pct IS NULL OR (inflation_pct >= 0 AND inflation_pct <= 200));
