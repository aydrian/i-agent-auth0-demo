<a href="https://chatbot.ai-sdk.dev/demo">
  <img alt="Chatbot" src="app/(chat)/opengraph-image.png">
  <h1 align="center">Chatbot</h1>
</a>

<p align="center">
    Chatbot (formerly AI Chatbot) is a free, open-source template built with Next.js and the AI SDK that helps you quickly build powerful chatbot applications.
</p>

<p align="center">
  <a href="https://chatbot.ai-sdk.dev/docs"><strong>Read Docs</strong></a> ·
  <a href="#features"><strong>Features</strong></a> ·
  <a href="#model-providers"><strong>Model Providers</strong></a> ·
  <a href="#deploy-your-own"><strong>Deploy Your Own</strong></a> ·
  <a href="#running-locally"><strong>Running locally</strong></a>
</p>
<br/>

## Features

- [Next.js](https://nextjs.org) App Router
  - Advanced routing for seamless navigation and performance
  - React Server Components (RSCs) and Server Actions for server-side rendering and increased performance
- [AI SDK](https://ai-sdk.dev/docs/introduction)
  - Unified API for generating text, structured objects, and tool calls with LLMs
  - Hooks for building dynamic chat and generative user interfaces
  - Supports OpenAI, Anthropic, Google, xAI, and other model providers via AI Gateway
- [shadcn/ui](https://ui.shadcn.com)
  - Styling with [Tailwind CSS](https://tailwindcss.com)
  - Component primitives from [Radix UI](https://radix-ui.com) for accessibility and flexibility
- Data Persistence
  - Postgres (local via Docker, or [Neon Serverless](https://vercel.com/marketplace/neon) in production) for saving chat history and user data
  - S3-compatible blob storage — [MinIO](https://min.io) locally, swappable for [Vercel Blob](https://vercel.com/storage/blob), AWS S3, Cloudflare R2, etc.
- [Auth0](https://auth0.com)
  - Universal Login and secure session management via [`@auth0/nextjs-auth0`](https://github.com/auth0/nextjs-auth0)

## Model Providers

This template uses the [Vercel AI Gateway](https://vercel.com/docs/ai-gateway) to access multiple AI models through a unified interface. Models are configured in `lib/ai/models.ts` with per-model provider routing. Included models: Mistral, Moonshot, DeepSeek, OpenAI, and xAI.

### AI Gateway Authentication

**For Vercel deployments**: Authentication is handled automatically via OIDC tokens.

**For non-Vercel deployments**: You need to provide an AI Gateway API key by setting the `AI_GATEWAY_API_KEY` environment variable in your `.env.local` file.

With the [AI SDK](https://ai-sdk.dev/docs/introduction), you can also switch to direct LLM providers like [OpenAI](https://openai.com), [Anthropic](https://anthropic.com), [Cohere](https://cohere.com/), and [many more](https://ai-sdk.dev/providers/ai-sdk-providers) with just a few lines of code.

## Deploy Your Own

You can deploy your own version of Chatbot to Vercel with one click:

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/templates/next.js/chatbot)

## Running locally

You will need the environment variables [defined in `.env.example`](.env.example) to run Chatbot. Copy it to `.env.local` and fill in the values:

```bash
cp .env.example .env.local
```

> Note: Do not commit `.env.local` — it will expose secrets that allow others to control access to your Auth0 tenant and LLM provider accounts.

### 1. Configure Auth0

Create a **Regular Web Application** in the [Auth0 dashboard](https://manage.auth0.com) (or via `auth0 apps create`) and set:

- **Allowed Callback URLs:** `http://localhost:3000/auth/callback`
- **Allowed Logout URLs:** `http://localhost:3000`
- **Allowed Web Origins:** `http://localhost:3000`

Copy the domain, client ID, and client secret into `.env.local`. Generate `AUTH0_SECRET` with `openssl rand -hex 32`.

### 2. Start local services (Postgres, Redis, MinIO)

The repo ships a `docker-compose.yml` that runs Postgres, Redis, and a MinIO S3-compatible blob store. Requires Docker Desktop (or any Docker Engine with Compose v2).

```bash
docker compose up -d       # start postgres, redis, and minio in the background
pnpm install
pnpm db:migrate            # apply Drizzle migrations to the local Postgres
pnpm dev                   # run the app on http://localhost:3000
```

The defaults in `.env.example` already point at the local containers — no changes needed unless you're using hosted services:

```
POSTGRES_URL=postgresql://postgres:postgres@localhost:5432/chatbot
REDIS_URL=redis://localhost:6379
S3_ENDPOINT=http://localhost:9000
S3_BUCKET=chatbot-uploads
```

The `minio-init` container automatically creates the `chatbot-uploads` bucket on first boot. The MinIO console is available at [localhost:9001](http://localhost:9001) (login `minioadmin` / `minioadmin`).

Stop the services with `docker compose down`. Use `docker compose down -v` to also delete the named volumes (`postgres_data`, `redis_data`, `minio_data`) and wipe all local data.

### Using hosted services instead

- **Postgres / Redis:** swap `POSTGRES_URL` and `REDIS_URL` for any hosted provider (Neon, Upstash, Vercel Postgres, etc.).
- **Blob storage:** set `BLOB_READ_WRITE_TOKEN` to use Vercel Blob instead of S3. Alternatively, point the `S3_*` variables at AWS S3, Cloudflare R2, or any S3-compatible service.

## CIBA Price-Drop Watchlist demo

This branch (`feat/ciba-watchlist`) demonstrates Auth0 CIBA + Guardian as out-of-session human-in-the-loop. An LLM agent runs on a cron, watches user-defined products, reasons over current price plus recent history, requests approval via Guardian push when the user's intent is satisfied, auto-purchases on approval, and surfaces the order confirmation in chat next session.

### Auth0 prerequisites (one-time)

Most of the setup is scripted. Install [`auth0`](https://auth0.github.io/auth0-cli/) and `jq`, then:

```bash
auth0 login                  # browser flow, one-time
pnpm setup:auth0             # idempotent: creates the API + adds the CIBA grant
```

Two manual steps remain:

1. In **Security → Multi-factor Auth**, enable **"Push Notification using Auth0 Guardian"** and select a Push Notification App. (CIBA push delivery uses Guardian; the CLI can't toggle this.)
2. Enroll your demo user in **Guardian** on a phone.

Then set the matching env vars in `.env.local` (see below).

### Local run

```bash
docker compose up -d        # postgres, redis, minio, shop-api
pnpm db:migrate
pnpm dev
```

Set the new env vars in `.env.local` (see `.env.example`):

- `SHOP_API_URL=http://localhost:8000/api/shop`
- `SHOP_API_AUDIENCE=https://api.shop-online-demo.com`
- `CRON_SECRET=<random>`
- `ADMIN_API_KEY=<random>` (must match the value the shop-api container reads)

### Demo helper

The full live-demo runbook lives at [`docs/demos/ciba-watchlist.md`](docs/demos/ciba-watchlist.md). The `pnpm demo:ciba-watchlist` script wraps the operator-side moves:

```bash
pnpm demo:ciba-watchlist check     # preflight: env vars, dev server, shop-api, Auth0 setup
pnpm demo:ciba-watchlist reset     # clear sales + drop watchlist rows between takes
pnpm demo:ciba-watchlist trigger   # POST /api/cron/check-watchlists with the right Bearer
```

### Demo flow

1. Sign in. In chat: *"Watch the iPhone 15 Pro and buy it if it drops below $1000."* (Or, to showcase history reasoning: *"…buy it if it matches its recent low."*)
2. Open the shop admin at <http://localhost:8000/admin>. Sign in with `ADMIN_API_KEY`. Put the iPhone on sale at $999.
3. Run `pnpm demo:ciba-watchlist trigger`. The cron loads active watches, the agent calls `getProductHistory` then `buyProduct`, and a Guardian push lands on your phone with a binding message that references both the rule and history (e.g. *"iPhone Pro 999 USD: under 1000, near 14d low."*).
4. Approve on phone. The trigger output shows `purchased: 1` and the `binding="..."` it sent to Auth0.
5. Open chat and send any message. The agent calls `watchlistList`, the order-confirmation card appears in chat, and the row's `acknowledgedAt` is set so it doesn't repeat.

`/api/cron/check-watchlists` is also wired to Vercel Cron (`vercel.json`) at one-minute cadence for production use. Locally, only the manual trigger executes it — Vercel Cron does not watch your dev server.

### Architecture

- **Cron route** (`app/api/cron/check-watchlists/route.ts`) loads active watches and runs an LLM agent per watch with `generateText` + `tools`. The agent decides whether the user's intent is satisfied, consults price history, and calls `buyProduct` (Auth0 SDK-wrapped CIBA tool) when it should act.
- **Auth0 AI SDK wrapper** (`lib/auth0-ai.ts`) builds the `withAsyncAuthorization` wrapper using `@auth0/ai-vercel`. The wrapper handles `/bc-authorize` + token polling automatically. `bindingMessage` is sanitized to Auth0's allowed character set (max 64 chars; no `$`, `?`, parens, etc.).
- **Cron tools** (`lib/ai/tools/buy-product.ts`, `lib/ai/tools/get-product-history.ts`) are the agent's hands: `buyProduct` returns a structured `{ ok, ... }` instead of throwing on CIBA failure so the cron can classify outcomes (purchased / denied / error); `getProductHistory` calls shop-api for daily prices.
- **Watchlist tools** (`lib/ai/tools/watchlist-{add,list,remove}.ts`) are the chat-side tools. `watchlistAdd` captures the user's intent verbatim. `watchlistList` returns active watches plus unacknowledged purchases (and atomically marks them acknowledged so they don't re-surface).
- **Surfacing in chat:** `lib/ai/agent-identity.ts` counts unacknowledged purchases per request; `lib/ai/prompts.ts` hoists an "URGENT: pending watchlist update" block to the top of the system prompt so the chat agent calls `watchlistList` even on a casual "hi". `components/chat/watchlist-display.tsx` renders the order confirmation as a styled card.
- **Shop-api** (`shop-api/`, FastAPI) provides the catalog, sale-aware reads, deterministic synthetic price history (`shop-api/data/seed_history.py` injects a realistic dip 5-9 days back per product), and a server-rendered admin UI under `/admin` for setting sales.

See [`docs/demos/ciba-watchlist.md`](docs/demos/ciba-watchlist.md) for the live demo runbook, [`docs/auth0-ciba-without-chat.md`](docs/auth0-ciba-without-chat.md) for the SDK-in-cron postmortem, [`docs/superpowers/specs/2026-05-26-ciba-price-watchlist-design.md`](docs/superpowers/specs/2026-05-26-ciba-price-watchlist-design.md) for the full design spec, and [`docs/superpowers/plans/2026-05-26-ciba-watchlist.md`](docs/superpowers/plans/2026-05-26-ciba-watchlist.md) for the step-by-step implementation plan.
