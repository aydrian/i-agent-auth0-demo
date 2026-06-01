# Camp AI NY — live demo cue card

5 minutes. Three pillars. Mac Mini M4 buy. Extracted from [`camp-ai-ny.md`](camp-ai-ny.md) for iPad-on-podium reference — pre-flight, reset, recovery, and FAQ live in the full runbook. Script wording matches the runbook; line breaks below are stage formatting (each break = a pause point). **Lead-in** lines exist only in this cue card — the runbook compresses everything into one **Say** block per beat.

| Time | Beat |
|---|---|
| 0:00–0:30 | Frame |
| 0:30–1:15 | Identity |
| 1:15–2:30 | Token Vault |
| 2:30–4:15 | CIBA |
| 4:15–5:00 | Wrap |
| +~0:30 | Optional: agent says no |

---

## 0:00–0:30 · Frame

**Do**

- Show the chat tab logged in.

**Say**

> Three problems every founder shipping an agent runs into.
>
> **One:** who's the user?
>
> **Two:** how does the agent call APIs without you holding their credentials?
>
> **Three:** how does it take high-stakes actions without bothering the user every single time *and* without going rogue?
>
> Five minutes, three pillars.
>
> **Let's go!**

---

## 0:30–1:15 · Identity

**Lead-in**

> Pillar one. Who is this agent talking to?

**Do**

- Send: *"hi, who are you?"*
- Agent introduces itself by the user's name and lists what it can do.
- Open `lib/ai/agent-identity.ts` in a side window; gesture at `buildAgentIdentity` returning `userName` + capabilities.

**Say**

> The agent isn't a generic assistant — it's *my* instance.
>
> Its system prompt knows who I am because the chat route resolves my Auth0 session and threads my name plus my linked accounts into the prompt at request time.
>
> Same plumbing tells it which capabilities are available right now versus which need authorization.
>
> *That* groundwork is what lets the next two pillars exist.

---

## 1:15–2:30 · Token Vault

**Lead-in**

> Pillar two — what happens when I ask the agent to actually *do* something?

**Do**

- Send: *"any unread emails from investors this month?"*
- `gmailSearch` runs → 401 → `TokenVaultInterrupt` → **Authorize** card renders.
- Click **Authorize**.
- On the Google consent screen, **read the scope aloud**: `gmail.readonly` only.
- Approve. Popup closes; chat resumes; investor email cards render.
- Send a *second* Gmail question: *"any newsletters from this week?"* — **no popup**.

**Say**

> Notice the agent didn't refuse.
>
> The tool ran, got a 401, and the UI surfaced this card — *the user* decides whether to authorize.
>
> Scope is `gmail.readonly`, not 'full mail access'. Auth0 stores the refresh token in Token Vault — never in our app.
>
> When I ask a *second* email question, no popup. Standing scoped access until I revoke.
>
> The agent never saw a Google credential — just a short-lived access token Auth0 minted at call time.

---

## 2:30–4:15 · CIBA

**Lead-in**

> Reading email is one thing. Let's give the agent something it can actually mess up.

**Do**

- Send: *"watch the Mac Mini M4 and buy it if it drops below $799 — I want one for my Exo cluster."*
- Agent confirms the watch.
- Pivot away from chat ("the agent runs on its own from here").
- Open <http://localhost:8000/admin>; drop Mac Mini to **$749 for 60 minutes**.
- Terminal: `pnpm demo:camp-ai-ny trigger`
- Phone buzzes.
- **Read the agent-composed binding message aloud** — emphasize the agent wrote it, not a template.
- Approve.

**Say**

> The watch row stores my intent in plain English.
>
> A cron tick wakes an LLM agent — same one I just talked to, but headless — that pulls current price plus history, decides whether my intent is satisfied, and *only then* fires CIBA.
>
> Auth0 routes a Guardian push to my phone with a binding message the agent itself composed.
>
> I approve, the agent gets a `product:buy`-scoped token for one call, and the purchase happens.
>
> If the agent had decided not to act, I'd never have been bothered.
>
> **The agent doesn't ask forgiveness — it asks permission, in real time.**

---

## 4:15–5:00 · Wrap

**Lead-in**

> Quick check — back in the chat.

**Do**

- Reopen chat.
- Send: *"hi"*
- Agent surfaces the order-confirmation card via the unacknowledged-purchase path.

**Say**

> The chat agent knows the autonomous one acted because the unacknowledged-purchase count is in its system prompt.
>
> Three Auth0 features stacked:
>
> - identity-aware system prompt
> - Token Vault for delegated standing access
> - CIBA for delegated single-action approval
>
> One control plane.
>
> **The agent owned the decision; I owned the consent.**

---

## Optional 6th beat — agent decides NOT to buy (~30s)

**Lead-in**

> One bonus beat: what if the price *doesn't* drop?

**Do**

- Set the Mac Mini sale to **$899** (above the $799 threshold).
- Run `pnpm demo:camp-ai-ny trigger`.
- Output: `purchased: 0, no-buy: 1` with the agent's reasoning in `note`.

**Say**

> The agent didn't act because my intent isn't satisfied at $899.
>
> No Guardian push. I wasn't bothered. No false-positive purchase.
>
> **The agent — not a hardcoded `if`-statement — owns the decision.**
