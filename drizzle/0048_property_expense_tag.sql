-- ملک: the hashtag its rent and running costs are recorded under — set once,
-- then stable, so its history stays linked (same rule as vehicle_assets).
ALTER TABLE public.real_estate_properties ADD COLUMN IF NOT EXISTS expense_tag text;
