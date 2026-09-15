-- 0032_tokenized_equity_class_label.sql
--
-- Tokenised stocks, indices and commodities are crypto tokens that track the
-- underlying asset — they are not "US shares". The asset class seeded for
-- them was named «سهام آمریکا»; rename it to «سهام توکنیزه». Label only: no
-- asset, account, posting or valuation row is touched.

UPDATE "asset_classes"
SET "name" = 'سهام توکنیزه'
WHERE "code" = 'equity' AND "name" = 'سهام آمریکا';
