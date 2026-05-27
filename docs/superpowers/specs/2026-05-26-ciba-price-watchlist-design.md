# CIBA Price-Drop Watchlist — Human-in-the-Loop Demo

**Status:** approved (2026-05-26)
**Branch:** `feat/ciba-watchlist`

## Context

This project currently demonstrates Auth0 Token Vault via a Gmail tool — *in-session* delegated access where the user is in chat when the auth flow runs. The next demo target is **CIBA (Client-Initiated Backchannel Authentication)** with the Auth0 Guardian app, where the agent's killer feature is acting **out-of-session**: a push lands on the user's phone unprompted, and approval authorizes a real action.

Concretely: the user adds products to a watchlist with a target price; a background cron checks shop-api prices; when a price drops to or below target, the cron initiates a CIBA push (e.g. *"Buy 1x iPhone 15 Pro at $999 (was $1199)?"*); the user taps approve in Guardian; the cron uses the resulting access token to place the order via shop-api. The next time the user opens chat, the agent surfaces the order confirmation.

This contrasts with `assistant0-vercel-arize`, which uses CIBA *in-session* via `withAsyncAuthorization` interrupt mode. We reuse its shop-api as the protected resource and its CIBA wiring as a reference, but shift the trigger from "user presses send in chat" to "cron observes a price drop while user is elsewhere."

## Architecture summary

| Component | Path | Status |
|---|---|---|
| FastAPI shop-api (copy from assistant0) | `shop-api/` | new |
| Sale support on shop-api | `shop-api/routers/shop.py`, `shop-api/admin.py`, `shop-api/data/sales.json` | new |
| `watchlist` Drizzle table + migration | `lib/db/schema.ts`, `lib/db/migrations/*` | new |
| Watchlist queries | `lib/db/queries.ts` | extended |
| Watchlist chat tools | `lib/ai/tools/watchlist-add.ts`, `watchlist-list.ts`, `watchlist-remove.ts` | new |
| Tool registration in chat route | `app/(chat)/api/chat/route.ts` | extended |
| Capability registry | `lib/ai/agent-capabilities.ts` | extended |
| Agent identity context (unack'd purchases hint) | `lib/ai/agent-identity.ts` | extended |
| Direct CIBA helper (cron-mode) | `lib/auth0-ciba.ts` | new |
| Cron route | `app/api/cron/check-watchlists/route.ts` | new |
| Sale trigger admin route | `app/api/admin/sale/route.ts` | new |
| Admin demo page | `app/admin/page.tsx` (+ client component) | new |
| Vercel cron config | `vercel.json` | new |
| Docker compose entry for shop-api | `docker-compose.yml` | extended |
| `.env.example` updates | repo root | extended |

## Data model

### `watchlist` table (Drizzle, in `lib/db/schema.ts`)

```ts
export const watchlist = pgTable("Watchlist", {
  id: uuid("id").primaryKey().notNull().defaultRandom(),
  userId: varchar("userId", { length: 255 }).notNull(),     // Auth0 sub
  productId: varchar("productId", { length: 64 }).notNull(),
  productName: text("productName").notNull(),               // snapshot for binding message
  targetPrice: numeric("targetPrice", { precision: 10, scale: 2 }).notNull(),
  status: varchar("status", {
    enum: ["active", "notified", "purchased", "denied", "error"],
  }).notNull().default("active"),
  createdAt: timestamp("createdAt").notNull(),
  notifiedAt: timestamp("notifiedAt"),
  lastSeenPrice: numeric("lastSeenPrice", { precision: 10, scale: 2 }),
  purchasedPrice: numeric("purchasedPrice", { precision: 10, scale: 2 }),
  purchaseDetails: json("purchaseDetails"),                  // shop-api OrderResponse
  orderId: text("orderId"),
  acknowledgedAt: timestamp("acknowledgedAt"),               // surfaced to user in chat
});
```

**Status transitions:**

- `active` → `notified` (CIBA push initiated)
- `notified` → `purchased` (approval + order placed); terminal for the entry
- `notified` → `denied` (user denied or push expired); resets to `active` after 24h so a sustained drop can re-fire
- `notified` → `error` (network/shop-api failure); resets to `active` after 24h
- A stalled `notified` row (older than 90s) gets reset to `active` at the start of each cron tick to recover from interrupted runs

### `sales.json` on shop-api

Single mutable file written by the admin endpoint, read on every catalog query:

```json
{ "iphone-15-pro": { "salePrice": 999, "expiresAt": "2026-05-27T00:00:00Z" } }
```

Read endpoints (`/search`, `/`) merge against the catalog and return the lower of `pricePerUnit` and active `salePrice`. Product responses gain a `salePrice` field (nullable). The existing `pricePerUnit` field continues to mean MSRP, so the cron can compare cleanly.

## Chat tools

All three live in `lib/ai/tools/`, follow the existing tool pattern (Zod input schema + `execute`), are scoped server-side by `session.user.sub`, and require **no** Token Vault wrapper (plain DB ops + unauthenticated shop-api search).

- **`watchlistAdd({ productQuery, targetPrice })`** — calls shop-api `/search?product=…` to fuzzy-resolve, persists `{ userId, productId, productName, targetPrice, status: "active", createdAt }`, returns the row plus current price.
- **`watchlistList()`** — returns three groups: `active`, `unacknowledgedPurchases`, `recentlyDenied`. **Side effect:** atomically sets `acknowledgedAt = now()` on the unacknowledged purchases it returned, so they don't re-surface. Each unacknowledged-purchase payload mirrors the assistant0 `shopOnlineTool` shape (`orderId, product, qty, subtotal, tax, total, estimatedDelivery, originalPrice, purchasedPrice`) so the agent can render a familiar order-confirmation block.
- **`watchlistRemove({ watchId })`** — deletes the row after verifying `userId` matches the session.

All three are registered in `app/(chat)/api/chat/route.ts` and added to `AGENT_CAPABILITIES` with `status: "registered"`. The system prompt gets a paragraph describing the watchlist capability.

## Out-of-session CIBA flow

### `lib/auth0-ciba.ts`

Server-side helper using `@auth0/ai` 6.x primitives (already installed). Exports:

```ts
export async function requestCibaApproval(args: {
  userId: string;            // Auth0 sub → login_hint
  bindingMessage: string;
  scopes: string[];          // e.g. ["openid", "product:buy"]
  audience: string;          // SHOP_API_AUDIENCE
  timeoutMs?: number;        // default 90_000
}): Promise<{ accessToken: string }>;
```

Implementation:

1. POST `/bc-authorize` to the Auth0 tenant with a `login_hint` for the user (e.g. `iss_sub` format), `binding_message`, `scope`, and `audience`.
2. Poll `/oauth/token` with `grant_type=urn:openid:params:grant-type:ciba` and the `auth_req_id`, respecting the `interval` from the response and capping at `timeoutMs`.
3. On success → return `{ accessToken }`. On `access_denied` / `expired_token` / `slow_down` exhaustion → throw a typed `CibaApprovalError` with `reason`.

If `@auth0/ai` 6.x doesn't expose direct CIBA primitives, fall back to plain `fetch` against `/bc-authorize` and `/oauth/token` — the same envelope used by `withAsyncAuthorization` internally.

### `app/api/cron/check-watchlists/route.ts`

Auth: `Authorization: Bearer ${CRON_SECRET}` (Vercel Cron sets this; the "Run now" button on `/admin` passes the same).

Logic:

1. Reset stalled `notified` rows (`notifiedAt` older than 90s) back to `active`.
2. Reset `denied`/`error` rows older than 24h back to `active`.
3. Load all `watchlist` rows where `status = "active"`.
4. Group by `productId`. Hit shop-api `/search?product=<productId>` once per distinct product to get `currentPrice` + `salePrice`.
5. For each row where `currentPrice <= targetPrice`:
   - Update row: `status = "notified"`, `notifiedAt = now()`, `lastSeenPrice = currentPrice`.
   - Build binding message: ``Buy 1x ${productName} at $${currentPrice} (was $${msrp})?``
   - `await requestCibaApproval({ userId, bindingMessage, scopes: ["openid", "product:buy"], audience: SHOP_API_AUDIENCE })`.
   - On approval: `POST` to `${SHOP_API_URL}` with `Authorization: Bearer <accessToken>`, body `{ productId, qty: 1 }`. On 2xx, update row: `status = "purchased"`, `orderId`, `purchasedPrice`, `purchaseDetails` (full OrderResponse), `acknowledgedAt = NULL`.
   - On `CibaApprovalError`: set `status = "denied"` (for `access_denied`/`expired_token`) or `"error"`.
6. Return `{ checked, triggered, purchased, denied, errors }` JSON for the admin "Run now" button to render.

Watches process sequentially within a tick (low volume in demo). Each tick caps total work to ~60s to fit a Vercel function budget.

`vercel.json`:

```json
{ "crons": [{ "path": "/api/cron/check-watchlists", "schedule": "*/1 * * * *" }] }
```

## Surfacing purchases in chat

`lib/ai/agent-identity.ts` already builds context concatenated into the system prompt. Extend it: at request time, count rows where `userId = session.user.sub AND status = "purchased" AND acknowledgedAt IS NULL`. If `> 0`, append to the prompt:

> *"While the user was away, N auto-purchase(s) were completed from their watchlist. Proactively surface these at the start of your reply by calling the `watchlistList` tool, then format each as a clear order confirmation (item, qty, was-price → bought-price, subtotal, tax, total, order ID, estimated delivery)."*

When the agent calls `watchlistList`, the tool returns the unacknowledged purchases with full order detail and atomically marks them acknowledged. The agent renders the confirmation block in chat (matching the assistant0 visual style). Subsequent turns won't repeat it; the row remains in history if the user asks.

## Admin / sale-trigger UI

`app/admin/page.tsx` — server component, gated by checking `session.user.email === ADMIN_EMAIL` (demo-grade gate; can swap for an Auth0 role later). Renders:

- Product table from shop-api, with current price and any active sale.
- Per row: inline "Sale price $___ for ___ minutes" + "Put on sale" / "Clear sale" buttons → `POST` / `DELETE` to `/api/admin/sale`.
- Top-level "Run watchlist check now" button → `POST /api/cron/check-watchlists` with the cron secret.
- Live result panel showing the last cron-tick summary.

`app/api/admin/sale/route.ts` proxies to shop-api admin endpoints with `X-Admin-Key: ${ADMIN_API_KEY}`.

shop-api gains:

- `POST /api/shop/admin/sale` body `{ productId, salePrice, durationMinutes }` → writes to `data/sales.json`.
- `DELETE /api/shop/admin/sale/{productId}` → removes the entry.
- Both protected by `X-Admin-Key` header check.
- `GET /api/shop/products` (or extend `/search` to return all when query is empty) so the admin page can list everything.

## Environment & infra

New env vars (add to `.env.example`):

```
SHOP_API_URL=http://localhost:8000/api/shop
SHOP_API_AUDIENCE=https://api.shop-online-demo.com
CRON_SECRET=<random>
ADMIN_API_KEY=<random>
ADMIN_EMAIL=<your-email>
```

Auth0 prerequisites (one-time, manual; document in README):

- API in Auth0 with the matching `audience` and `product:buy` scope.
- CIBA enabled on the application; user enrolled in Guardian on a phone.
- `AUTH0_CLIENT_ID` / `AUTH0_CLIENT_SECRET` / `AUTH0_DOMAIN` already present from existing wiring.

`docker-compose.yml` — add a `shop-api` service:

```yaml
shop-api:
  build: ./shop-api
  container_name: chatbot-shop-api
  ports: ["8000:8000"]
  restart: unless-stopped
```

shop-api copy: bring `shop-api/` from `assistant0-vercel-arize` (Dockerfile, `pyproject.toml`, `main.py`, `routers/`, `models.py`, `data/catalog.json`, plus an empty `data/sales.json`), then layer the admin endpoints and sale-merge logic on top. The copy is self-contained — no runtime dependency on the assistant0 repo.

## Reused patterns (do not reinvent)

- **Tool wrapping & registration**: mirror `lib/ai/tools/gmail-search.ts` for tool shape; registration site is `app/(chat)/api/chat/route.ts` (existing tools object around L215–234).
- **Auth session**: `auth0.getSession()` from `lib/auth0.ts`. Use `session.user.sub` as the watchlist owner.
- **Capability registry**: append entries to `lib/ai/agent-capabilities.ts` with `status: "registered"`.
- **Drizzle migration workflow**: `pnpm db:generate && pnpm db:migrate`.
- **CIBA shape (binding_message, scopes, audience)**: reference `assistant0-vercel-arize/src/lib/auth0-ai.ts:64-106` and `assistant0-vercel-arize/src/lib/tools/shop-online.ts:7-79`. Same scopes/audience; different invocation path (direct, server-side, blocking).

## Verification (end-to-end demo)

1. `git checkout feat/ciba-watchlist`
2. Copy shop-api from assistant0; add admin endpoints; verify `docker compose up shop-api` and `curl http://localhost:8000/api/shop/search?product=iphone` returns a product.
3. `pnpm db:generate && pnpm db:migrate` after adding the watchlist schema. Verify with `pnpm db:studio` that the table exists.
4. `pnpm dev`. Sign in as your demo user.
5. In chat: *"Watch the iPhone 15 Pro and tell me if it drops below $1000"* → confirm `watchlistAdd` runs, row appears in DB, agent confirms.
6. Open `/admin`. Confirm gate works (sign-in required, email matches `ADMIN_EMAIL`).
7. Click "Put iPhone 15 Pro on sale at $999 for 60 minutes." Verify shop-api `/search?product=iphone-15-pro` now returns `salePrice: 999`.
8. Click "Run watchlist check now."
9. Phone receives Guardian push: `Buy 1x iPhone 15 Pro at $999 (was $1199)?`. Approve.
10. Admin page summary updates: `purchased: 1`. DB row → `status = "purchased"`, `orderId`, `acknowledgedAt = NULL`. shop-api logs the order.
11. Open chat in a fresh session, send "hi". Agent calls `watchlistList`, renders the order-confirmation block, row's `acknowledgedAt` flips. Send another message — confirmation does NOT re-appear.
12. Run cron again with no further drop — no extra pushes; `purchased` rows are terminal.
13. Negative paths to spot-check:
    - Decline on Guardian → row → `denied`, no order placed.
    - Let push expire → row → `denied`, no order placed.
    - shop-api stops mid-flight → row → `error`, retried next tick.

## Out of scope (explicit non-goals)

- Multi-quantity purchases (always qty=1 in demo).
- Real notification UI (toast/badge) outside the chat surface.
- Fancy admin auth (Auth0 role + middleware) — `ADMIN_EMAIL` env check is enough for demo.
- Multi-currency, tax variations, regional pricing.
- Race condition between Vercel Cron and "Run now" button (rely on `status = "active"` filter + atomic update; double-process is harmless given the demo's purchase volume).
