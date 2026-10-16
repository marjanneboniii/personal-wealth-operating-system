-- «از این پول خرج می‌کنم»: a stablecoin or exchange-Toman account the user
-- spends from counts in the cash-flow forecast. Additive only.
ALTER TABLE public.accounts ADD COLUMN IF NOT EXISTS spend_from boolean NOT NULL DEFAULT false;
