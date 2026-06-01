# Camp AI NY — Closing CTA spec

Markdown spec for the closing slide. Lift into the day-of slide deck (Keynote / Google Slides / etc.) — one slide, ~10s on screen at the end of the Wrap beat (held during Q&A backdrop is fine too).

This is content + intent, not visual design — let the deck owner translate to slide-master typography.

## Slide content

### Header

> **Auth0 for AI Agents — three pillars, one control plane**

### Body — three equal-weight columns (or stacked cards on portrait)

| | | |
|---|---|---|
| **Identity** | **Token Vault** | **CIBA** |
| The agent knows who the user is. Auth0 session resolved at request time, threaded into the system prompt with the user's name and linked accounts. | The agent calls third-party APIs on the user's behalf. Refresh tokens live in Auth0; your app never holds them. Scopes pinned per integration. | The agent takes high-stakes actions when you're not in the loop. Push consent to the user's phone with a binding message the agent itself composes. |

### Kicker (large, centered under the three columns)

> **The agent owned the decision; you owned the consent.**

*(This is the demo's praised closing line, lightly adapted from "I owned the consent" so the slide reads to the audience.)*

### Footer / get started

- **Try it:** *insert canonical Auth0-for-AI URL — e.g. auth0.com/ai or the relevant docs page*
- **Read the code:** *insert demo repo URL*
- *(Optional)* QR code linking to one of the above for stage scanability

## Speaker note (~10s, end of Wrap)

> *"Three pillars, one identity surface. Identity-aware prompts, Token Vault for standing scoped access, CIBA for in-the-moment consent. The repo is open if you want to read the code — and if you're shipping an agent, this is where to start."*

## Design notes for the deck owner

- Keep the three pillars visually equal-weight; this slide **is** the recap.
- Don't add a fourth column or a feature matrix — the demo's argument is "three pillars stacked, one control plane." More columns dilutes it.
- The kicker line (`The agent owned the decision; you owned the consent`) is the line audience members repeat back. Make it readable from the back of the room.
- If using a QR code, make it big enough to scan from row 5 — this is the only moment the audience can capture a link.

## Open items

- Final URL(s) for **Try it** + **Read the code** — pick before deck export.
- Decide whether to put the kicker on this slide *or* defer it to a separate dramatic slide between the demo end and Q&A.
