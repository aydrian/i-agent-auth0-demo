# Camp AI NY — 5-Minute Auth0-for-AI-Agents Demo

> "You're shipping an agent that does real work for real users. Three problems will bite you: the agent needs to know whose user it is, it needs to call third-party APIs without you holding the keys, and at some point it has to take a high-stakes action without you in the loop. Here's all three in five minutes."

This is the runbook for a single fluid 5-minute demo at Camp AI NY (audience: AI startup founders) covering **agent/user identity → Token Vault → CIBA**. It's a remix of the existing pillar-specific runbooks ([`ciba-watchlist.md`](ciba-watchlist.md), [`token-vault.md`](token-vault.md)) tightened to one arc with Mac Mini M4 in place of the iPhone (the OpenClaw / Exo-cluster meme — local-LLM founders are hoarding M-series Macs for inference, and the agent buying compute is the joke).

## Pre-flight (one-time per machine)

- App + dependencies running:
  ```bash
  docker compose up -d
  pnpm dev
  ```
- Auth0 setup completed once: `pnpm setup:auth0`, Guardian push enabled in **Security → Multi-factor Auth**, demo user enrolled in Guardian on a phone. (Same as `ciba-watchlist.md` pre-flight.)
- Google social connection in Auth0 with **Token Vault enabled** and `https://www.googleapis.com/auth/gmail.readonly` in allowed scopes. (Same as `token-vault.md` pre-flight — manual dashboard step.)
- Mac Mini M4 in `shop-api/data/catalog.json`. If you just edited it, restart the container so `shop-api/routers/shop.py` reloads the JSON: `docker compose up -d --force-recreate shop-api`.
- **Gmail seeder credentials** in `.env.local` — one-time setup via the [Google OAuth Playground](https://developers.google.com/oauthplayground):
  1. In a Google Cloud project (anything you control — separate from the Auth0 Google connection), create an **OAuth 2.0 Client ID** of type **Web application**. Add `https://developers.google.com/oauthplayground` to its authorized redirect URIs.
  2. Open the OAuth Playground. Click the gear icon (top right) → check **Use your own OAuth credentials** → paste the client ID and secret.
  3. In the left panel, scroll to **Gmail API v1** and select these two scopes:
     - `https://www.googleapis.com/auth/gmail.insert`
     - `https://www.googleapis.com/auth/gmail.modify`
  4. Click **Authorize APIs**. Sign in as the demo Gmail account.
  5. Click **Exchange authorization code for tokens**. Copy the **refresh token** that appears.
  6. Paste into `.env.local`:
     ```
     SEED_GMAIL_CLIENT_ID=<your-client-id>
     SEED_GMAIL_CLIENT_SECRET=<your-client-secret>
     SEED_GMAIL_REFRESH_TOKEN=<the-refresh-token>
     ```
- Browser windows queued: chat at <http://localhost:3000/>, profile at <http://localhost:3000/profile>, shop admin at <http://localhost:8000/admin> (sign in once with `ADMIN_API_KEY` from `.env.local` — the cookie persists 24h).
- Phone with Guardian app open, signed into the demo user account.

Run `pnpm demo:camp-ai-ny check` to confirm preflight before going live.

These seeder credentials are operator-only scaffolding. They live in a totally separate OAuth client from the user's Token Vault grant — the user's grant stays pinned at `gmail.readonly`, which is the demo's whole point.

## Between-takes reset

```bash
pnpm demo:camp-ai-ny clear-gmail   # trash the seeded investor emails
pnpm demo:camp-ai-ny seed-gmail    # re-seed (timestamps refresh to "recent")
pnpm demo:camp-ai-ny reset         # clear shop sales + watchlist rows
```

Then open <http://localhost:3000/profile> and click **Disconnect** on the Google account so the next take starts cold for Token Vault. (No programmatic helper exists — `lib/actions/profile.ts:deleteConnectedAccount` is a Next.js server action, not an HTTP route.)

## Day-of stage setup

**Before walking on:**

- **Drop the Mac Mini sale to $749** for ≥60 minutes via <http://localhost:8000/admin>. The CIBA beat now fires the cron *before* showing the admin tab, so the price drop must already be in place when you go live.
- **Phone screen mirror via QuickTime.** Tether the demo phone to the laptop via Lightning/USB-C cable — *not* wireless mirroring (Chris flagged Wi-Fi/VPN can break this at the venue). Then: QuickTime → **File → New Movie Recording** → click the dropdown next to the record button → select the connected phone. Drag QuickTime onto the projected display.
- **Practice the binding-message zoom.** During CIBA the audience needs to read the Guardian binding message from the back of the room. Pinch-to-zoom (or `cmd`+scroll) on the QuickTime window so the message is legible — memorise the gesture so you don't fumble live.
- **Re-test at the venue.** Wi-Fi and corporate VPN behavior at the venue can differ from the office. Run mirror + `pnpm demo:camp-ai-ny trigger` end-to-end after setting up the projector, before doors.

## Live demo (~5 min)

| Time | Beat | What you do | What you say |
|---|---|---|---|
| 0:00–0:30 | Frame | Show the chat tab logged in. Pause for hands. | "Quick show of hands — who here is shipping an agent today? OK, who's planning to in the next six months? Cool, that's most of you. Three problems bite every team shipping an agent for real users. One: who's the user — does the agent know? Two: how does the agent call third-party APIs without your app holding the user's credentials? Three: how does it take high-stakes actions without bothering the user every single time *and* without going rogue? Five minutes, three pillars." |
| 0:30–1:15 | **Identity** | Send *"hi, who are you?"*. Agent introduces itself by the user's name and lists what it can do. Open `lib/ai/agent-identity.ts` in a side window and gesture at `buildAgentIdentity` returning `userName` + capabilities. | "The agent your user signs into isn't generic — it's *their* instance. The system prompt knows who they are because the chat route resolves their Auth0 session and threads their name plus their linked accounts into the prompt at request time. Same plumbing tells the agent which capabilities are available right now versus which need authorization. *That* groundwork is what lets the next two pillars exist." |
| 1:15–2:30 | **Token Vault** | Send *"any unread emails from investors this month?"*. The `gmailSearch` tool runs, hits a 401, throws `TokenVaultInterrupt`, and the chat renders an **Authorize** card. Click **Authorize**. On the Google consent screen, **read the scope aloud**: `gmail.readonly` only. Approve. Popup closes, chat resumes, email cards render with the seeded investor messages. Send a *second* Gmail question — *"any newsletters from this week?"* — **no popup**. | "Notice the agent didn't refuse. The tool ran, got a 401, and the UI surfaced this card — *your user* decides whether to authorize. Scope is `gmail.readonly`, not 'full mail access'. Auth0 stores the user's refresh token in Token Vault — your app never touches it. When the user asks a *second* email question, no popup. Standing scoped access until the user revokes. Your agent never sees a Google credential — just a short-lived access token Auth0 mints at call time." |
| 2:30–3:45 | **CIBA** | Quick context: *"the Shop API you're about to see is a stand-in for any e-commerce backend — think Amazon or Shopify."* Send *"watch the Mac Mini M4 and buy it if it drops below $799 — I want one for my Exo cluster."* Agent confirms the watch. Pivot away from chat ("the agent runs on its own from here"). In a terminal: `pnpm demo:camp-ai-ny trigger` — say *"because this is a demo I can't wait for the cron to fire, so I'm forcing the tick now."* Phone buzzes. Read the **agent-composed** binding message aloud — emphasize the agent wrote it, not a template. Approve. *Then* open <http://localhost:8000/admin>; the Mac Mini sale is already at $749 from pre-flight. Say: *"behind the scenes the price had dropped — the agent saw it before I did."* | "The watch row stores the user's intent in plain English. A cron tick wakes an LLM agent — same one we just talked to, but headless — that pulls current price plus history, decides whether the user's intent is satisfied, and *only then* fires CIBA. Auth0 routes a Guardian push to the user's phone with a binding message the agent itself composed. The user approves, the agent gets a `product:buy`-scoped token for one call, and the purchase happens. If the agent had decided not to act, the user would never have been bothered. **The agent doesn't ask forgiveness — it asks permission, in real time.**" |
| 3:45–4:30 | Wrap | Reopen chat, send *"hi"*. Agent surfaces the order-confirmation card via the unacknowledged-purchase path. | "The chat agent knows the autonomous one acted because the unacknowledged-purchase count is in its system prompt. Three Auth0 features stacked: identity-aware system prompt, Token Vault for delegated standing access, CIBA for human-in-the-loop approval. One control plane. The agent owned the decision; I owned the consent." |
| 4:30–5:00 | Buffer | Optional 6th beat or pacing slack. | — |

### Optional 6th beat: agent decides NOT to buy

If you want to extend by ~30s, set the Mac Mini sale to $899 (above the $799 threshold) and run `pnpm demo:camp-ai-ny trigger`. Output shows `purchased: 0, no-buy: 1` with the agent's reasoning in `note`. Talking point:

> "The agent didn't act because my intent isn't satisfied at $899. No Guardian push, I wasn't bothered, no false-positive purchase. The agent — not a hardcoded `if`-statement — owns the decision."

## Recovery / fallback

- **Email cards render with no investor emails.** Seeder didn't run, or the operator was signed into the wrong Google account. `pnpm demo:camp-ai-ny clear-gmail && pnpm demo:camp-ai-ny seed-gmail`. If that fails, re-run the OAuth Playground walkthrough — refresh tokens can be revoked silently by Google.
- **Authorize popup fails to open.** Browser blocked it. Click again — most browsers prompt for permission on the second attempt.
- **Popup approves but chat doesn't resume.** Send any new chat message — the next turn re-fetches the now-valid access token. (Underlying: `components/auth0-ai/tool-token-vault-interrupt.tsx` calls `interrupt.resume()` on popup close; if it misses, the next turn picks it up.)
- **Push didn't land in 5s.** Guardian app is closed on the phone, or the wrong tenant is active. Worst case: deny the existing push and re-run `pnpm demo:camp-ai-ny trigger`.
- **Cron returns `purchased: 0, no-buy: 1` when you wanted a buy.** The agent decided not to act — usually because the sale price wasn't below the watch's threshold. Lower the sale price below $799 and re-trigger.
- **DB row stuck in `notified`.** It auto-resets after 90s. Or run `pnpm demo:camp-ai-ny reset` to wipe.
- **Order confirmation repeats on later turns.** Bug — the `acknowledgedAt` flip didn't write. Reset and try again.
- **Shop admin won't accept your key.** Make sure `ADMIN_API_KEY` in `.env.local` matches what the shop-api container has. After editing `.env.local`, restart shop-api: `docker compose up -d --force-recreate shop-api`.
- **Mac Mini missing from the catalog.** Restart shop-api after editing `shop-api/data/catalog.json`: `docker compose up -d --force-recreate shop-api`. The `seed_history.py` curve generator is product-id-parameterized, so the new product gets its own deterministic price-history dip without any seed edits.

## FAQ (one-line answers)

- **"Why three pillars in one demo and not just one?"** Because in production these aren't three separate features — they're one identity-aware agent that does *everything* under one consent surface. Showing them in isolation hides the integration win.
- **"Why CIBA for the buy and Token Vault for Gmail?"** Different threat models. Reading email is ongoing low-risk scoped access — pushing the user to approve every Gmail call would be unusable. A purchase is a discrete high-stakes action — the user should see what they're approving every time. CIBA's binding message is built for exactly that.
- **"Could the agent escalate scopes silently?"** No. Scopes are pinned at `lib/auth0-ai.ts:7-11` (Gmail) and the cron-side wrapper (`product:buy`). Adding `gmail.send` is a code change *and* a fresh consent screen. Auth0 won't satisfy a scope from a refresh token the user didn't consent to.
- **"What if the LLM hallucinates a buy?"** Tools execute through CIBA. The user sees the agent-composed binding message on Guardian and approves consciously. Hallucinated reasoning shows up in the binding message; the user judges.
- **"Where does the refresh token live?"** In Auth0, never in our app. We get short-lived access tokens on demand via `getAccessTokenFromTokenVault()`. Same for the cron-side `withAsyncAuthorization` wrapper.
- **"How is this different from Connected Apps / Federated Connections?"** Same family. Token Vault is the productized agent-flavored API on top, with `getAccessTokenFromTokenVault()` as the SDK call and the consent + popup flow handled by `@auth0/nextjs-auth0` + `@auth0/ai-vercel`.
- **"Why an LLM if the rule is simple?"** Because rules don't have to be simple. The user can write *"buy if it drops below $799 OR if Apple cuts the M4 line"* and the agent reads it. A literal `if`-statement can't.
- **"Are the investor emails real?"** Operator-seeded — five canned messages with `[demo:camp-ai-ny]` in the subject so the cleanup script can find them. The seeder runs on operator-only OAuth credentials with a *different* scope set than the Token Vault grant. The user sitting at the demo machine can read their actual inbox just fine after the demo.

## Where the moving parts live

- Camp AI NY runbook (this file) — `docs/demos/camp-ai-ny.md`
- Operator helper — `scripts/demos/camp-ai-ny.sh` (`check`/`reset`/`trigger`/`seed-gmail`/`clear-gmail`)
- Gmail seeder — `scripts/demos/seed-gmail.ts`
- Mac Mini catalog entry — `shop-api/data/catalog.json` (id `mac-mini-m4`)
- Price history curve — `shop-api/data/seed_history.py` (auto-applies to any new product id via `shop-api/history.py:29`)
- Agent identity — `lib/ai/agent-identity.ts` + `lib/ai/agent-capabilities.ts`
- System prompt assembly — `lib/ai/prompts.ts`
- Token Vault wrapper — `lib/auth0-ai.ts` (`withGmailRead`, scopes pinned)
- Gmail tool — `lib/ai/tools/gmail-search.ts`
- Authorize card (popup + auto-resume) — `components/auth0-ai/tool-token-vault-interrupt.tsx`
- Connected accounts (the Disconnect button on `/profile`) — `lib/actions/profile.ts` + `components/profile/connected-accounts-card.tsx`
- CIBA wrapper — `lib/auth0-ai.ts` (`withShopBuyApproval`)
- Cron agent + reasoning loop — `app/api/cron/check-watchlists/route.ts`
- Cron-side tools — `lib/ai/tools/buy-product.ts`, `lib/ai/tools/get-product-history.ts`
- Watchlist chat tools — `lib/ai/tools/watchlist-{add,list,remove}.ts`
- Shop admin UI — `shop-api/routers/admin_ui.py`
