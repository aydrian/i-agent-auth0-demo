CREATE TABLE IF NOT EXISTS "Watchlist" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"userId" varchar(255) NOT NULL,
	"productId" varchar(64) NOT NULL,
	"productName" text NOT NULL,
	"targetPrice" numeric(10, 2) NOT NULL,
	"status" varchar DEFAULT 'active' NOT NULL,
	"createdAt" timestamp NOT NULL,
	"notifiedAt" timestamp,
	"lastSeenPrice" numeric(10, 2),
	"purchasedPrice" numeric(10, 2),
	"purchaseDetails" json,
	"orderId" text,
	"acknowledgedAt" timestamp
);
