-- Recurring-income plans stored the entry's USD amount in amount_base, while
-- the forecast and the planning page read amount_base as contractual Toman:
-- a 45,000,000-Toman salary entered the cash-flow projection as 450. New
-- plans now store Toman (src/app/actions.ts). This converts the PENDING ones
-- already written, so the forecast is right before the next occurrence.
--
-- A Toman or Rial account: the plan's own native amount IS the Toman figure,
-- exactly. Any other unit (Tether, dollar): the stored USD × the user's
-- current rate — the best figure available, and it is only a forecast.
--
-- Guarded to rows that are visibly USD-scaled, so a re-run, or a row that is
-- already Toman, is left alone.
UPDATE public.planned_transactions p
   SET amount_base = CASE
         WHEN a.symbol = 'IRT' THEN round(p.amount_native)
         WHEN a.symbol = 'IRR' THEN round(p.amount_native / 10)
         ELSE round(p.amount_base * fx.current_rate)
       END,
       updated_at = now()
  FROM public.accounts acc
  JOIN public.assets a ON a.id = acc.asset_id
  LEFT JOIN public.user_fx_settings fx ON fx.user_id = acc.user_id
 WHERE acc.id = p.to_account_id
   AND p.category_id IS NOT NULL
   AND p.amount_native IS NOT NULL
   AND p.direction = 'inflow'
   AND p.status = 'pending'
   AND p.deleted_at IS NULL
   AND (
         (a.symbol = 'IRT' AND p.amount_base * 1000 < p.amount_native)
      OR (a.symbol = 'IRR' AND p.amount_base * 10000 < p.amount_native)
      OR (a.symbol NOT IN ('IRT', 'IRR') AND fx.current_rate > 0 AND p.amount_base < p.amount_native * 10)
       );
