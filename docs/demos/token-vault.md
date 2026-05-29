# Token Vault — 5-Minute Demo

> "CIBA delegates a *single action* at the moment of approval. Token Vault delegates *standing* access — once, by the user, in a consent flow they recognize — and the agent then has scoped access to a third-party API on their behalf, backed by a refresh token that lives in Auth0, not in our app."

This is the runbook for demoing Token Vault (Gmail read) to an internal Auth0 audience. Pairs naturally with the CIBA watchlist demo (`docs/demos/ciba-watchlist.md`). Target length: ~5 minutes.

## Pre-flight (one-time per machine)

- App + dependencies running:
  ```bash
  docker compose up -d
  pnpm dev
  ```
- Auth0 setup completed once: `pnpm setup:auth0` (this configures CIBA; the Google connection is separate — see next bullet).
- **Google social connection configured in Auth0** — `pnpm setup:auth0` does *not* do this. In the Auth0 Dashboard:
  1. Authentication → Social → create or open the **Google / google-oauth2** connection. Provide your Google OAuth client ID + secret.
  2. On the connection's settings, enable **Token Vault** and ensure the allowed scopes include `https://www.googleapis.com/auth/gmail.readonly`.
  3. Make sure the connection is enabled for this app's client.
- Gmail account ready that you're willing to consent with during the demo (any Google account — does not have to match the chat user's email).
- `enableConnectAccountEndpoint: true` is already set in `lib/auth0.ts`. Nothing for you to flip — just don't be surprised that `/auth/connect` works out of the box.
- Browser windows queued: chat at <http://localhost:3000/>, profile at <http://localhost:3000/profile> (open in a separate tab; you'll switch to it during the revoke beat).

## Between-takes reset

No helper script — the UI is faster:

1. Open <http://localhost:3000/profile>.
2. Click **Disconnect** on the Google account row.
3. Reload chat.

The next Gmail question will trigger Token Vault from cold again. (Powered by `deleteConnectedAccount` in `lib/actions/profile.ts`, which calls Auth0's `/me/v1/connected-accounts` API — same thing the user could do themselves.)

If the UI ever errors out, fall back to: Auth0 Dashboard → Users → demo user → **Identities** tab → unlink the Google identity.

## Live demo (~5 min)

| Time | Beat | What you do | What you say |
|---|---|---|---|
| 0:00–0:30 | Setup + frame | Show the chat tab. | "I just demoed CIBA — single-action approval at the moment the agent acts. Token Vault is the other side of that coin: *standing* access, scoped, granted once. The agent here can read my Gmail. Let's see what happens the first time it tries." |
| 0:30–1:15 | Cold ask | Type *"Any unread emails from Stripe this month?"*. The agent calls `gmailSearch`, hits a 401, and the chat renders an **Authorize** card with a Gmail lock icon. **Don't click it yet.** | "Notice what *didn't* happen. The agent didn't refuse, didn't apologize, didn't say 'I can't access your email.' The tool ran, hit a 401 from Google, threw a `TokenVaultInterrupt`, and the UI rendered this card. The system prompt explicitly tells the agent to let this surface — the *user* decides whether to authorize." |
| 1:15–2:15 | The consent flow | Click **Authorize**. A Google OAuth popup opens (URL is `/auth/connect?connection=google-oauth2&scopes=...`). On the consent screen, **read the scope aloud**: it's `gmail.readonly`, not "full mail access". Approve. Popup closes. The chat thread resumes automatically. | "This is a regular Google consent screen — same one you've seen a thousand times. The scope is *just* `gmail.readonly`. Auth0 stores the resulting refresh token in Token Vault. When the popup closes, the chat detects it and resumes the interrupted tool call — no extra click." |
| 2:15–3:15 | The payoff | The same `gmailSearch` re-runs. Email cards render with sender, subject, date, snippet. | "Here's the part to notice: **the agent never saw a Google credential.** It called `getAccessTokenFromTokenVault()`, Auth0 minted a short-lived access token from the stored refresh token, the tool used that token for one call, and threw it away. We don't store, rotate, or breach-disclose Google refresh tokens. Auth0 is the system of record." |
| 3:15–4:15 | The "standing" part | Ask a *second* unrelated Gmail question — *"any newsletters from this week?"*. Cards render. **No popup.** | "**This is the difference from CIBA.** CIBA would have asked again — every action gets a binding message and a Guardian push. Token Vault doesn't, until the user revokes. That's by design: reading email isn't a discrete high-stakes action, it's ongoing scoped access. Pushing the user to approve every call would be obnoxious." |
| 4:15–5:00 | The revoke | Switch to the `/profile` tab. Show the connected Google account card. Click **Disconnect**. Switch back to chat and ask another Gmail question. The **Authorize** card returns. | "The user is *always* in control. One click on their profile, and the standing grant is gone. Auth0 deletes the refresh token, our app starts seeing 401s on the next call, and the agent goes back to asking. CIBA + Token Vault: two shapes of delegated access, one consistent control plane." |

### Optional 6th beat: scope escalation

If you want to extend by ~30s and you've got the audience, gesture at the agent saying *"I can read your inbox but not send"* and explain: the scopes are pinned in `lib/auth0-ai.ts` (`withGmailRead`). Adding `gmail.send` would require a code change *and* a fresh consent screen — Auth0 will not satisfy a scope from a refresh token the user didn't consent to. Talking point:

> "*Even if I, the developer, decide tomorrow that the agent should send mail, the user has to re-consent. The vault is scoped, not a blank check.*"

## Recovery / fallback

- **Authorize popup fails to open.** Browser blocked it. Click again — most browsers prompt for permission on the second attempt.
- **Popup opens but the consent screen errors with `connection not found` or `connection disabled`.** The Google connection isn't configured for this app. Back to pre-flight bullet #2: confirm the Google connection exists, has Token Vault enabled, and is enabled for the chat app's client.
- **Popup approves but chat doesn't resume.** The popup-close watcher in `components/auth0-ai/tool-token-vault-interrupt.tsx` calls `interrupt.resume()`. If it doesn't fire, send any new chat message — the next turn re-fetches the now-valid access token.
- **Second Gmail query *also* shows the Authorize card.** The refresh token didn't get persisted. Most likely cause: Token Vault isn't enabled on the Google connection in Auth0. Check the dashboard, then disconnect + reconnect.
- **`/profile` → Disconnect doesn't actually revoke.** The connected-accounts API call may have errored silently. Hard fallback: Auth0 Dashboard → Users → demo user → Identities → unlink Google.

## FAQ (one-line answers)

- **"Why not CIBA for reading email?"** Reading email isn't a discrete action with a binding message — it's ongoing, low-risk, scoped access. Pushing the user to approve every Gmail call would be obnoxious. CIBA shines for *purchase*, *transfer*, *delete* — single high-stakes actions.
- **"Where does the refresh token live?"** In Auth0, never in our app. The chat backend calls `getAccessTokenFromTokenVault()` and Auth0 mints a short-lived access token from the stored refresh token at call time.
- **"What if Google revokes the grant on its side?"** The tool's `try/catch` (`lib/ai/tools/gmail-search.ts:91–99`) re-throws as `TokenVaultInterrupt` — same code path as first-time consent — and the UI surfaces **Authorize** again.
- **"Can the agent escalate scopes silently?"** No. Scopes are pinned in `lib/auth0-ai.ts:7–11`. Adding `gmail.send` requires a code change *and* a fresh consent screen. Auth0 will not satisfy a scope from a refresh token the user didn't consent to.
- **"Token Vault vs storing OAuth tokens in our own DB?"** With Token Vault we never see the refresh token. We don't have to encrypt it at rest, rotate it, or disclose its breach. Auth0 is the system of record; we get short-lived access tokens on demand.
- **"How is this different from a Connected App / Federated Connection?"** It's the same family — Token Vault is the productized agent-flavored API on top of Federated Connections, with `getAccessTokenFromTokenVault()` as the SDK call and the consent + popup flow handled by `@auth0/nextjs-auth0` + `@auth0/ai-vercel`.

## Where the moving parts live

- Token Vault wrapper — `lib/auth0-ai.ts` (`withGmailRead`, lines 7–11)
- Gmail tool — `lib/ai/tools/gmail-search.ts` (`getAccessTokenFromTokenVault` + `TokenVaultInterrupt` on 401)
- Authorize card (popup + auto-resume) — `components/auth0-ai/tool-token-vault-interrupt.tsx`
- Chat dispatch of the interrupt — `components/chat/message.tsx` (the `tool-gmailSearch` branch around line 228)
- `/auth/connect` endpoint — provided by `@auth0/nextjs-auth0`; turned on by `enableConnectAccountEndpoint: true` in `lib/auth0.ts`
- Connected-accounts management — `lib/actions/profile.ts` (`fetchConnectedAccounts`, `deleteConnectedAccount`)
- Profile page (where the user disconnects) — `app/(chat)/profile/page.tsx` + `components/profile/connected-accounts-card.tsx`
- System prompt block telling the agent to let the interrupt surface — `lib/ai/prompts.ts` (`userDataToolsPrompt`, lines 6–22)
