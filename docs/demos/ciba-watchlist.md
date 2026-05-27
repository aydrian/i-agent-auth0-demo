# CIBA Price-Drop Watchlist — 5-Minute Demo

> "The agent can act on the user's behalf even when the user isn't in chat — and Auth0 CIBA + Guardian is how the human stays in the loop."

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
| 0:00–0:30 | Setup + frame | Show chat tab. | "I've added a watchlist feature. The agent watches products and pings me when a price drops to my target. The interesting part is what happens when I'm not here." |
| 0:30–1:30 | Add the watch | Type *"Watch the iPhone 15 Pro and let me know if it drops below $1000."* Show the agent's confirmation. | "It resolved 'iPhone 15 Pro' against the catalog and stored a watch entry against my Auth0 sub. Standard chat tool — no Auth0 magic yet." |
| 1:30–2:00 | The pivot | Close the chat tab (or alt-tab away). | "Now I'm done with chat. The agent is still on the hook for me. Let's see what happens when a price drops." |
| 2:00–2:45 | Trigger the sale | Open `/admin`, set iPhone 15 Pro to $999 for 60 minutes. Click **Run watchlist check now**. | "I'm playing the role of the shop here. The cron normally runs on a Vercel schedule — I'm just firing it on demand." Hold for the result panel. |
| 2:45–3:30 | **Phone buzzes** | Show the Guardian notification. Read the binding message aloud: *"Buy 1x iPhone 15 Pro at $999 (was $1199)?"* Tap approve. | "**This is CIBA.** The cron initiated a backchannel auth request with a binding message. I'm not in the app, I don't have a session — Auth0 still knows it's me because Guardian is enrolled to my account. The agent gets back an access token scoped to `product:buy` for this audience only." |
| 3:30–4:30 | Surface in chat | Reopen chat. Send *"hi"*. Agent surfaces the order block (item, was $1199 → bought $999, total, order id, ETA). | "The agent knows this happened because the system prompt counts unacknowledged purchases on every turn. The `watchlistList` tool returns them once and atomically marks them acknowledged — so I only see this confirmation once, not on every reply." |
| 4:30–5:00 | Wrap | Send another message ("anything else?"). Agent answers normally — no repeat of the confirmation. | "Three Auth0 features stacked: CIBA grant for the backchannel call, Guardian as the notification channel, and the binding message so the user approves *that specific action*. Without those, the agent either has standing access (scary) or has to ask the user later (slow)." |

## Recovery / fallback

- **Push didn't land in 5s.** Check the Guardian app is open on the phone, and that `auth0 tenants list` shows the right active tenant. Worst case: deny the existing push and click **Run watchlist check now** again.
- **Cron returns `triggered: 0`.** The sale price isn't actually below the watch target. Re-set the sale at a lower price.
- **DB row stuck in `notified`.** It auto-resets after 90s. Or run `pnpm demo:ciba-watchlist reset` to wipe.
- **Agent repeats the order confirmation on later turns.** That's a bug — the `acknowledgedAt` flip didn't write. Reset and try again.

## FAQ (one-line answers)

- **"Is this latency-sensitive?"** No — CIBA polls server-side. The agent just `await`s.
- **"Can it auto-buy without my approval?"** No — the access token is only minted after Guardian approve. Deny → no token → no purchase.
- **"What stops a malicious cron from spamming pushes?"** Auth0 rate-limits CIBA per tenant (500/min, 5000 pending), and the binding message is shown verbatim so the user sees what they're approving.
- **"Why not Token Vault?"** Token Vault is delegated *standing* access (Gmail). CIBA is delegated *single-action* access at the moment of approval — different threat model.

## Where the moving parts live

- Watchlist tools (chat) — `lib/ai/tools/watchlist-{add,list,remove}.ts`
- CIBA helper — `lib/auth0-ciba.ts`
- Cron route — `app/api/cron/check-watchlists/route.ts`
- `/admin` UI — `app/admin/page.tsx` + `app/admin/admin-client.tsx`
- "Surface on next chat turn" — `lib/ai/agent-identity.ts` + `lib/ai/prompts.ts` (the `watchlistAlert` block)
