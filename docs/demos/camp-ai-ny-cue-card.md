# Camp AI NY — live demo cue card

5 minutes. Three pillars. Mac Mini M4 buy. Extracted from [`camp-ai-ny.md`](camp-ai-ny.md) for iPad-on-podium reference — pre-flight, reset, recovery, and FAQ live in the full runbook. Script wording matches the runbook; line breaks below are stage formatting (each break = a pause point). **Lead-in** lines exist only in this cue card — the runbook compresses everything into one **Say** block per beat.

| Time | Beat |
|---|---|
| 0:00–0:30 | Frame |
| 0:30–1:15 | Identity |
| 1:15–2:30 | Token Vault |
| 2:30–3:45 | CIBA |
| 3:45–4:30 | Wrap |
| 4:30–5:00 | Buffer / optional: agent says no |

---

## 0:00–0:30 · Frame

**Do**

- Show the chat tab logged in.
- Ask the audience the show-of-hands question; pause for hands on each.

**Say**

> Quick show of hands — who here is shipping an agent today?
>
> OK, who's planning to in the next six months?
>
> Cool, that's most of you. Three problems bite every team shipping an agent for real users.
>
> **One:** who's the user — does the agent know?
>
> **Two:** how does it call third-party APIs without your app holding the user's credentials?
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

> The agent your user signs into isn't generic — it's *their* instance.
>
> The system prompt knows who they are because the chat route resolves their Auth0 session and threads their name plus their linked accounts into the prompt at request time.
>
> Same plumbing tells the agent which capabilities are available right now versus which need authorization.
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
> The tool ran, got a 401, and the UI surfaced this card — *your user* decides whether to authorize.
>
> Scope is `gmail.readonly`, not 'full mail access'. Auth0 stores the user's refresh token in Token Vault — your app never touches it.
>
> When the user asks a *second* email question, no popup. Standing scoped access until the user revokes.
>
> Your agent never sees a Google credential — just a short-lived access token Auth0 mints at call time.

---

## 2:30–3:45 · CIBA

**Lead-in**

> Reading email is one thing. Let's give the agent something it can actually mess up.
>
> Quick context first — the "Shop API" you're about to see is a stand-in for any e-commerce backend, think Amazon or Shopify.

**Do**

- Send: *"watch the Mac Mini M4 and buy it if it drops below $799 — I want one for my Exo cluster."*
- Agent confirms the watch.
- Pivot away from chat ("the agent runs on its own from here").
- Terminal: `pnpm demo:camp-ai-ny trigger`. Say: *"because this is a demo I can't wait for the cron to fire, so I'm forcing the tick now."*
- Phone buzzes.
- **Read the agent-composed binding message aloud** — emphasize the agent wrote it, not a template.
- Approve.
- *Then* open <http://localhost:8000/admin>; Mac Mini sale already at **$749** (dropped pre-flight). Say: *"behind the scenes the price had dropped — the agent saw it before I did."*

**Say**

> The watch row stores the user's intent in plain English.
>
> A cron tick wakes an LLM agent — same one we just talked to, but headless — that pulls current price plus history, decides whether the user's intent is satisfied, and *only then* fires CIBA.
>
> Auth0 routes a Guardian push to the user's phone with a binding message the agent itself composed.
>
> The user approves, the agent gets a `product:buy`-scoped token for one call, and the purchase happens.
>
> If the agent had decided not to act, the user would never have been bothered.
>
> **The agent doesn't ask forgiveness — it asks permission, in real time.**

---

## 3:45–4:30 · Wrap

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
