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

This branch (`feat/ciba-watchlist`) demonstrates Auth0 CIBA + Guardian as out-of-session human-in-the-loop. The agent watches user-defined products, requests approval via Guardian push when prices drop, auto-purchases on approval, and surfaces the order confirmation in chat next session.

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
- `ADMIN_EMAIL=<your demo user's email>`

### Demo flow

1. Sign in. In chat: *"Watch the iPhone 15 Pro and let me know if it drops below $1000."*
2. Open `/admin` (page is gated by `ADMIN_EMAIL`). Put the iPhone on sale at $999 for some duration.
3. Click "Run watchlist check now". A Guardian push lands on your phone with binding message *"Buy 1x iPhone 15 Pro at $999.00 (was $1199.00)?"*.
4. Approve on phone. The admin page's result panel shows `purchased: 1`.
5. Open chat (or send a new message). The agent calls `watchlistList`, surfaces the order confirmation, and the row's `acknowledgedAt` is set so it doesn't repeat.

`/api/cron/check-watchlists` is also wired to Vercel Cron (`vercel.json`) at one-minute cadence for production use.

### Architecture

- **Cron route** (`app/api/cron/check-watchlists/route.ts`) loads active watches, fetches current prices from shop-api, fires CIBA pushes for drops, and auto-purchases on approval.
- **CIBA helper** (`lib/auth0-ciba.ts`) is a direct Auth0 `/bc-authorize` + `/oauth/token` polling helper — used out-of-session, distinct from the in-session interrupt flow that `@auth0/ai-vercel`'s `withAsyncAuthorization` provides.
- **Watchlist tools** (`lib/ai/tools/watchlist-{add,list,remove}.ts`) are plain DB ops; `watchlistList` returns active watches plus unacknowledged purchases (and atomically marks them acknowledged so they don't re-surface).
- **Surfacing in chat:** `lib/ai/agent-identity.ts` counts unacknowledged purchases per request; `lib/ai/prompts.ts` injects a "## Pending watchlist update" block into the system prompt that prompts the agent to call `watchlistList` and present the order confirmation.
- **Shop-api** (`shop-api/`, FastAPI) gained a `sales.json` state file, sale-aware catalog reads, and admin endpoints for sale set/clear and product list.
- **Demo admin** (`/admin`) gives a quick UI to put items on sale and trigger the cron check on demand without waiting for the Vercel scheduler.

See `docs/superpowers/specs/2026-05-26-ciba-price-watchlist-design.md` for the full design spec and `docs/superpowers/plans/2026-05-26-ciba-watchlist.md` for the step-by-step implementation plan.
