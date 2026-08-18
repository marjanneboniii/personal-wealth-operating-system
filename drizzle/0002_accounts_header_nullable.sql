-- Parent/header Chart-of-Accounts rows (1000, 2000, 3000, 4000, 5000) are
-- grouping rows with no instrument or wallet. They must be insertable with a
-- NULL asset_id / wallet_id, so any legacy NOT NULL constraint is dropped here.
-- Money accounts (bank/cash) keep their own asset_id and are unaffected.
ALTER TABLE "accounts" ALTER COLUMN "asset_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "accounts" ALTER COLUMN "wallet_id" DROP NOT NULL;
