# Camp AI NY — live demo cue card

5 minutes. Three pillars. Mac Mini M4 buy. Extracted from [`camp-ai-ny.md`](camp-ai-ny.md) for iPad-on-podium reference — pre-flight, reset, recovery, and FAQ live in the full runbook. Script wording matches the runbook. Each beat reads as a sequential script: *italics* are stage directions (things you do or things that happen), blockquotes (`> `) are spoken lines in the order you say them.

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

*Show the chat tab logged in.*

> Quick show of hands — who here is shipping an agent today?

*Pause for hands.*

> OK, who's planning to in the next six months?

*Pause for hands.*

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

> Pillar one. Who is this agent talking to?

*Send chat:* "hi, who are you?"

*Agent introduces itself by the user's name and lists what it can do.*

> The agent your user signs into isn't generic — it's *their* instance.
>
> The system prompt knows who they are because the chat route resolves their Auth0 session and threads their name plus their linked accounts into the prompt at request time.

*Open `lib/ai/agent-identity.ts` in a side window; gesture at `buildAgentIdentity` returning `userName` + capabilities.*

> Same plumbing tells the agent which capabilities are available right now versus which need authorization.
>
> *That* groundwork is what lets the next two pillars exist.

---

## 1:15–2:30 · Token Vault

> Pillar two — what happens when I ask the agent to actually *do* something?

*Send chat:* "any unread emails from investors this month?"

*`gmailSearch` runs → 401 → `TokenVaultInterrupt` → **Authorize** card renders.*

> Notice the agent didn't refuse.
>
> The tool ran, got a 401, and the UI surfaced this card — *your user* decides whether to authorize.

*Click **Authorize**. On the Google consent screen, read the scope aloud — `gmail.readonly` only.*

> Scope is `gmail.readonly`, not 'full mail access'. Auth0 stores the user's refresh token in Token Vault — your app never touches it.

*Approve. Popup closes; chat resumes; investor email cards render.*

*Send a second Gmail question:* "any newsletters from this week?" *— no popup.*

> When the user asks a *second* email question, no popup. Standing scoped access until the user revokes.
>
> Your agent never sees a Google credential — just a short-lived access token Auth0 mints at call time.

---

## 2:30–3:45 · CIBA

> Reading email is one thing. Let's give the agent something it can actually mess up.
>
> Quick context first — the "Shop API" you're about to see is a stand-in for any e-commerce backend, think Amazon or Shopify.

*Send chat:* "watch the Mac Mini M4 and buy it if it drops below $799 — I want one for my Exo cluster."

*Agent confirms the watch.*

> The watch row stores the user's intent in plain English.

*Pivot away from chat.*

> The agent runs on its own from here.
>
> A cron tick wakes an LLM agent — same one we just talked to, but headless — that pulls current price plus history, decides whether the user's intent is satisfied, and *only then* fires CIBA.

*Terminal:* `pnpm demo:camp-ai-ny trigger`

> Because this is a demo I can't wait for the cron to fire, so I'm forcing the tick now.

*Phone buzzes.*

> Auth0 routes a Guardian push to the user's phone with a binding message the agent itself composed.

*Read the agent-composed binding message aloud — emphasize the agent wrote it, not a template.*

*Approve on phone.*

> The user approves, the agent gets a `product:buy`-scoped token for one call, and the purchase happens.
>
> If the agent had decided not to act, the user would never have been bothered.
>
> **The agent doesn't ask forgiveness — it asks permission, in real time.**

*Open <http://localhost:8000/admin>; Mac Mini sale already at $749 (dropped pre-flight).*

> Behind the scenes the price had dropped — the agent saw it before I did.

---

## 3:45–4:30 · Wrap

> Quick check — back in the chat.

*Reopen chat. Send:* "hi"

*Agent surfaces the order-confirmation card via the unacknowledged-purchase path.*

> The chat agent knows the autonomous one acted because the unacknowledged-purchase count is in its system prompt.
>
> Three Auth0 features stacked:
>
> - identity-aware system prompt
> - Token Vault for delegated standing access
> - CIBA for human-in-the-loop approval
>
> One control plane.
>
> **The agent owned the decision; I owned the consent.**

---

## Optional 6th beat — agent decides NOT to buy (~30s)

> One bonus beat: what if the price *doesn't* drop?

*Set the Mac Mini sale to $899 (above the $799 threshold).*

*Run* `pnpm demo:camp-ai-ny trigger`. *Output:* `purchased: 0, no-buy: 1` *with the agent's reasoning in `note`.*

> The agent didn't act because my intent isn't satisfied at $899.
>
> No Guardian push. I wasn't bothered. No false-positive purchase.
>
> **The agent — not a hardcoded `if`-statement — owns the decision.**
