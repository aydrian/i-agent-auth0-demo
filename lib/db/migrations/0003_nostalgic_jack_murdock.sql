ALTER TABLE "Watchlist" ADD COLUMN "intent" text NOT NULL;--> statement-breakpoint
ALTER TABLE "Watchlist" DROP COLUMN IF EXISTS "targetPrice";