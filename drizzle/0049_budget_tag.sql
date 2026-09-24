-- بودجه روی برچسب: a budget measures either an expense account (as before)
-- or every expense carrying one hashtag («#سفر_مشهد»), in frozen Toman.
ALTER TABLE public.budgets ADD COLUMN IF NOT EXISTS tag text;
