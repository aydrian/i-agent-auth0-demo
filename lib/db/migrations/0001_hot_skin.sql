-- Auth0 migration: drop the local User table and retype userId columns.
-- Chat/Document/Suggestion.userId change from uuid (FK to User.id) to
-- varchar(255) holding an Auth0 `sub` string (e.g. `auth0|…`, `google-oauth2|…`).
--
-- Destructive: any existing rows in User-scoped tables cannot be mapped to
-- Auth0 identities, so they are truncated. This demo has no production data.

-- 1. Drop FK constraints pointing at User.id
ALTER TABLE IF EXISTS "Chat" DROP CONSTRAINT IF EXISTS "Chat_userId_User_id_fk";--> statement-breakpoint
ALTER TABLE IF EXISTS "Document" DROP CONSTRAINT IF EXISTS "Document_userId_User_id_fk";--> statement-breakpoint
ALTER TABLE IF EXISTS "Suggestion" DROP CONSTRAINT IF EXISTS "Suggestion_userId_User_id_fk";--> statement-breakpoint

-- 2. Truncate user-scoped tables so uuid→varchar conversion is safe.
--    CASCADE clears downstream Message_v2 / Vote_v2 / Stream rows tied to chats,
--    and Suggestion rows tied to documents.
TRUNCATE TABLE "Chat" CASCADE;--> statement-breakpoint
TRUNCATE TABLE "Document" CASCADE;--> statement-breakpoint

-- 3. Retype userId columns from uuid to varchar(255)
ALTER TABLE "Chat" ALTER COLUMN "userId" TYPE varchar(255) USING "userId"::text;--> statement-breakpoint
ALTER TABLE "Document" ALTER COLUMN "userId" TYPE varchar(255) USING "userId"::text;--> statement-breakpoint
ALTER TABLE "Suggestion" ALTER COLUMN "userId" TYPE varchar(255) USING "userId"::text;--> statement-breakpoint

-- 4. Drop the User table
DROP TABLE IF EXISTS "User" CASCADE;
