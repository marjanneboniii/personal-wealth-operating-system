ALTER TABLE "debts" ADD COLUMN "principal_toman" numeric(38, 18);--> statement-breakpoint
ALTER TABLE "debts" ADD COLUMN "principal_usd_created" numeric(38, 18);--> statement-breakpoint
ALTER TABLE "installments" ADD COLUMN "amount_toman" numeric(38, 18);--> statement-breakpoint
ALTER TABLE "installments" ADD COLUMN "amount_usd_created" numeric(38, 18);--> statement-breakpoint
ALTER TABLE "installments" ADD COLUMN "paid_toman" numeric(38, 18);--> statement-breakpoint
ALTER TABLE "installments" ADD COLUMN "paid_usd" numeric(38, 18);--> statement-breakpoint
ALTER TABLE "installments" ADD COLUMN "paid_fx_rate" numeric(38, 18);
