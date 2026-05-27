# CIBA Price-Drop Watchlist — 5-Minute Demo

> "An AI agent monitors your watchlist on its own schedule, reasons about whether to act, and asks for permission via Auth0 CIBA + Guardian when it decides to buy. The user defines the rule in plain English; the agent evaluates it against current price + recent history."

This is the runbook for demoing the CIBA price-drop watchlist feature to an internal Auth0 audience. Target length: ~5 minutes.

## Pre-flight (one-time per machine)

- App + dependencies running:
  ```bash
  docker compose up -d
  pnpm dev
  ```
- Auth0 setup completed once: `pnpm setup:auth0` and Guardian enrolled on a phone.
- Phone with the Guardian app, signed into the demo user account.
- Browser windows queued: chat at <http://localhost:3000/>, admin at <http://localhost:3000/admin>.
- Recommended terminal layout: one tab for `pnpm dev`, one for ad-hoc DB peek (`docker compose exec postgres psql -U postgres -d chatbot`).

Run `pnpm demo:ciba-watchlist check` to verify preflight before going live.

## Between-takes reset

```bash
pnpm demo:ciba-watchlist reset
```

Clears active sales on shop-api and drops every row from the `Watchlist` table. Safe to run any time — the dev DB has no real users.

## Live demo (~5 min)

| Time | Beat | What you do | What you say |
|---|---|---|---|
| 0:00–0:30 | Setup + frame | Show chat tab. | "I've added a watchlist, but the interesting bit isn't the watchlist — it's *who* decides when to buy. The user describes a rule in plain English, and an AI agent evaluates it on a schedule. When the agent decides to act, that's when CIBA fires." |
| 0:30–1:30 | Add the watch | Type *"Watch the iPhone 15 Pro and buy it if the price drops below $1000."* Show the agent's confirmation. | "Note: the watchlist row stores the user's intent in plain English — not a number. *That* matters in a minute. Standard chat tool wires this into the database against my Auth0 sub." |
| 1:30–2:00 | The pivot | Close the chat tab (or alt-tab away). | "I'm done with chat. From here on, the agent runs on its own. Let's see what happens when a price drops." |
| 2:00–2:45 | Trigger the sale | Open `/admin`, set iPhone 15 Pro to $999 for 60 minutes. Click **Run watchlist check now**. | "I'm playing the role of the shop. The cron normally runs on a Vercel schedule — I'm just firing it on demand. Now the agent loads the watch, sees the current price, sees the last 14 days of history, and decides." |
| 2:45–3:30 | **Phone buzzes** | Show the Guardian notification. Read the binding message aloud — emphasize that the agent *composed* the message, it's not from a template. Tap approve. | "**This is CIBA, but driven by the agent.** The agent decided to act, and it composed the message I just read on Guardian. Auth0 knows it's me because Guardian is enrolled to my account. The agent gets back a `product:buy`-scoped token only after I approve." |
| 3:30–4:30 | Surface in chat | Reopen chat. Send *"hi"*. Agent surfaces the order block. | "The chat agent knows the purchase happened because the system prompt counts unacknowledged auto-purchases. Calling `watchlistList` returns them once and atomically marks them acknowledged — so the confirmation appears once, not on every reply." |
| 4:30–5:00 | Wrap | Send another message ("anything else?"). Agent answers normally. | "Three Auth0 features stacked: CIBA grant + Guardian channel + binding message — all of it triggered because *the agent*, not a hardcoded condition, decided to act on my behalf." |

### Optional 7th beat: agent decides NOT to buy

If you want to extend by ~30s, set the iPhone sale to $1099 (above the user's $1000 target) and click **Run watchlist check now**. The result panel will show `purchased: 0, no-buy: 1` with the agent's text explaining why. Talking point:

> "*The agent didn't act because the user's intent isn't satisfied at $1099. No push fired, the user wasn't bothered. The agent owns the decision.*"

## Recovery / fallback

- **Push didn't land in 5s.** Check the Guardian app is open on the phone, and that `auth0 tenants list` shows the right active tenant. Worst case: deny the existing push and click **Run watchlist check now** again.
- **Cron returns `purchased: 0, no-buy: 1`.** The agent decided not to act. Check the `note` field in the result panel — it'll have the agent's reasoning. If you wanted it to act, lower the sale price below the watch's intent threshold.
- **DB row stuck in `notified`.** It auto-resets after 90s. Or run `pnpm demo:ciba-watchlist reset` to wipe.
- **Agent repeats the order confirmation on later turns.** That's a bug — the `acknowledgedAt` flip didn't write. Reset and try again.

## FAQ (one-line answers)

- **"Why an LLM if the rule is simple?"** Because rules don't have to be simple. The user can write *"buy if it drops below $1000 OR if Apple announces a new model"* and the agent reads it. An `if`-statement can't.
- **"What if the LLM hallucinates a buy?"** Tools execute through CIBA. The user sees the binding message on Guardian and approves consciously. Hallucinated reasoning shows up in the binding message; the user judges.
- **"Is the LLM call expensive?"** Negligible — `gpt-4o-mini`-class with `temperature: 0`, one call per active watch per tick. ~$0.001/tick at typical demo volumes.
- **"Why not Token Vault?"** Token Vault is delegated *standing* access (Gmail). CIBA is delegated *single-action* access at the moment of approval. Different threat model.
- **"Can it auto-buy without my approval?"** No. Tool execution suspends in `withAsyncAuthorization` until Guardian approves. Deny → no token → no purchase.
- **"What stops a malicious cron from spamming pushes?"** Auth0 rate-limits CIBA per tenant (500/min, 5000 pending) and the binding message is shown verbatim — the user always sees what they're approving.

## Where the moving parts live

- Watchlist tools (chat) — `lib/ai/tools/watchlist-{add,list,remove}.ts`
- CIBA wrapper (the SDK piece) — `lib/auth0-ai.ts` (`withShopBuyApproval` factory)
- Cron agent loop — `app/api/cron/check-watchlists/route.ts`
- Price history (shop-api side) — `shop-api/history.py` + `shop-api/data/seed_history.py`
- `/admin` UI — `app/admin/page.tsx` + `app/admin/admin-client.tsx`
- "Surface on next chat turn" — `lib/ai/agent-identity.ts` + `lib/ai/prompts.ts` (the `watchlistAlert` block)
