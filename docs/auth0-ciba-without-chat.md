# Auth0 CIBA in cron context: gotchas and how to use the SDK correctly

## TL;DR

`@auth0/ai-vercel`'s `withAsyncAuthorization` wrapper **does work** for cron-driven CIBA flows — the `setAIContext` + function-mode `onAuthorizationRequest` combo gives you blocking behavior and a real Guardian push. We just hit three gotchas that combined to look like a structural failure when it wasn't:

1. `setAIContext({ threadID })` is required even in non-chat contexts. Without it, the wrapped tool is silently inert.
2. Auth0's `binding_message` parameter has both a length cap (64 chars) and a strict character allowlist (`a-z`, `A-Z`, `0-9`, whitespace, `+ - _ . , : #`). Common LLM output like `$999?` gets the request rejected with HTTP 400.
3. **The SDK silently swallows `/bc-authorize` errors.** When Auth0 rejects the request (for any reason — bad binding message, missing scope, anything that returns 4xx), the wrapper does not propagate the error to the caller. Instead it returns fabricated credentials. Calling code thinks the flow succeeded, places the order, and the user gets no push. **This is a real SDK bug worth filing upstream** — it cost us most of a day and would silently bypass user consent in any production deployment.

This doc records what we tried, how we got fooled, and the working pattern so the next person can skip the trail of breadcrumbs.

## What the cron actually needs

`app/api/cron/check-watchlists/route.ts` runs without a chat session. For each active watchlist row, it asks an LLM "should we buy?" and the LLM may call a `buyProduct` tool. That tool needs to:

1. Send a CIBA push to the user's Guardian phone with a binding message.
2. **Block** until the user approves, denies, or the request times out.
3. On approval, use the access token to POST the order to shop-api.

No chat, no `<Suspense>` boundary, no UI to catch interrupts. Pure server-side blocking CIBA polling.

## How to do it (the working pattern)

### `lib/auth0-ai.ts` — wrapper factory

```ts
import { Auth0AI } from "@auth0/ai-vercel";
import { setWatchNotified } from "./db/queries/watchlist";

const auth0AI = new Auth0AI();

const ALLOWED_BINDING_MESSAGE_RE = /[^A-Za-z0-9\s+\-_.,:#]/g;

export function sanitizeBindingMessage(input: string): string {
  return input
    .replace(ALLOWED_BINDING_MESSAGE_RE, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 64);
}

export const withShopBuyApproval = (params: {
  watchId: string;
  userId: string;
  currentPrice: number;
}) =>
  auth0AI.withAsyncAuthorization({
    userID: async () => params.userId,
    // SANITIZE before sending — Auth0 will reject anything outside the allowlist.
    bindingMessage: async ({ bindingMessage }: { bindingMessage: string }) =>
      sanitizeBindingMessage(bindingMessage),
    scopes: ["openid", "product:buy"],
    audience: process.env.SHOP_API_AUDIENCE!,
    // Function-mode (not "interrupt") puts the wrapper into blocking mode.
    // The hook fires the moment /bc-authorize succeeds, before Guardian
    // approval. `await creds` blocks until the user approves or it times out.
    onAuthorizationRequest: async (_authReq, creds) => {
      await setWatchNotified(params.watchId, params.currentPrice);
      await creds;
    },
  });
```

### `lib/ai/tools/buy-product.ts` — wrapped tool

```ts
import { getAsyncAuthorizationCredentials } from "@auth0/ai-vercel";
import { tool } from "ai";
import { z } from "zod";
import { withShopBuyApproval } from "@/lib/auth0-ai";

export const buyProduct = (params: BuyProductParams) =>
  withShopBuyApproval(params)(
    tool({
      description: "...",
      inputSchema: z.object({
        // Constrain at the schema level too, so the LLM gets immediate
        // feedback if it tries to send something invalid.
        bindingMessage: z.string().min(1).max(64).describe(
          "MAX 64 chars. Allowed: a-z, A-Z, 0-9, whitespace, + - _ . , : #"
        ),
        qty: z.number().int().positive().default(1),
      }),
      execute: async ({ qty }) => {
        const credentials = getAsyncAuthorizationCredentials();
        const accessToken = credentials?.accessToken;
        if (!accessToken) {
          // Defensive: the SDK has a known bug where it sometimes returns
          // empty credentials when /bc-authorize was actually rejected.
          // Surface it as a clean tool-result error instead of placing the
          // order with a bogus token.
          return { ok: false, error: "no_access_token", ... };
        }
        // ... place the order with accessToken ...
      },
    })
  );
```

### `app/api/cron/check-watchlists/route.ts` — call site

```ts
import { setAIContext } from "@auth0/ai-vercel";

for (const watch of watches) {
  // REQUIRED: without setAIContext the wrapped tool is silently inert.
  // Use the watch.id as a synthetic threadID — we're not in chat, but the
  // wrapper needs *some* context to register against.
  setAIContext({ threadID: watch.id });

  const result = await generateText({
    model: ...,
    system: AGENT_SYSTEM_PROMPT,
    prompt: ...,
    tools: { buyProduct: buyProduct({ ... }) },
  });
}
```

## What fooled us

We arrived at this pattern by elimination. Here's the trail in case the same symptoms show up again.

### Symptom: `purchased` reported, no push delivered

The cron's response said `purchased: 1` and the watch row got marked `purchased`, but the user's phone never buzzed. Real CIBA never happened — the SDK had returned fabricated credentials, and shop-api (which doesn't validate JWTs in this demo) accepted them.

### What we tried (wrong directions)

1. **Removing `setAIContext`.** Without it, the wrapped tool was registered in the `tools` object, the schema looked correct (`description` + `inputSchema` both present), but the model's tool-call attempts produced zero invocations. The wrapper is inert without an AI context to bind state against.
2. **Adding `setAIContext({ threadID })` per watch.** Now the model invoked the tool, but `onAuthorizationRequest` was never called. We thought this meant the SDK was structurally broken in cron.
3. **Bypassing the wrapper entirely with a hand-rolled `requestCibaApproval`.** This actually worked — and surfaced the real bug: Auth0 was returning `400 binding_message can contain only alphanumerics, whitespace and \`+-_.,:#\` characters`.

### What was actually happening

Step 2 was misleading because the LLM's binding messages contained `$` and `?`. Auth0 was rejecting `/bc-authorize` with HTTP 400. The SDK wrapper was catching that 400 internally, throwing nothing, and returning empty credentials. Our `getAsyncAuthorizationCredentials()` call returned an object that looked valid enough to pass our `accessToken != null` check (or shop-api accepted whatever it got), and the tool reported success.

`onAuthorizationRequest` never fired because it's only called when `/bc-authorize` succeeds — failed requests skip the hook entirely. So the absence of the diagnostic log was a true signal of failure, but we read it as "the wrapper isn't even trying."

### What we changed to fix it

- **Sanitize `binding_message`** in the wrapper config (`lib/auth0-ai.ts`). Strips `$`, `?`, parens, quotes, slashes, etc. before sending. Auth0 stops rejecting the request, the wrapper's `onAuthorizationRequest` actually fires, the user gets a push.
- **Constrain at the input schema level too** (`z.string().max(64)` plus a description listing the allowlist). The LLM gets immediate feedback if it produces an invalid value.
- **Tighten the agent system prompt** to mention the binding_message restrictions explicitly. Most modern models comply if told.

After these three fixes, `pnpm demo:ciba-watchlist trigger` reliably produces a Guardian push within ~1 second of the cron call.

## The SDK bug worth filing

The most expensive symptom — silent success when `/bc-authorize` is rejected — is a real bug in `@auth0/ai-vercel`. The wrapper should propagate non-2xx responses from `/bc-authorize` so callers can see what Auth0 said. Hiding the error and returning fabricated credentials means a misconfigured CIBA setup will silently bypass user consent in production.

Reproducible against `@auth0/ai-vercel@5.1.1` + `@auth0/ai@6.0.2`:

1. Configure `withAsyncAuthorization` with a function `onAuthorizationRequest` (blocking mode).
2. Have the wrapped tool's `bindingMessage` factory return a string with a forbidden character (e.g. `$`).
3. Call the wrapped tool from inside `generateText`. The Auth0 dashboard logs show `ciba_start_failed` with the binding-message error.
4. The tool's `execute` runs. `getAsyncAuthorizationCredentials()` returns truthy data. No exception is thrown.

Fix expected from the SDK: a 4xx from `/bc-authorize` should throw an error that propagates through `protect()` to the tool's caller.

## Watch out for

- **`gpt-5.4-mini`** has a strong bias against purchase-on-behalf flows even when explicitly authorized. It may refuse to call the tool with hallucinated "missing credentials" reasoning. We use `xai/grok-4.1-fast-non-reasoning` by default in the cron's `pickAgentModel()`; `AGENT_MODEL=...` in `.env.local` overrides.
- **Stale dev server.** Next.js' Turbopack/HMR sometimes doesn't pick up changes to non-page modules. If the diagnostic logs you expect aren't appearing, hard-restart `pnpm dev` (Ctrl+C and re-run; `rm -rf .next` if needed).
- **Guardian enrollment.** "Phone is enrolled" can mean two things: the user got past the MFA setup screen at signup, OR they have a confirmed `push` factor in Auth0's enrollment table. Only the second one delivers CIBA pushes. Check via `auth0 api get "users/<encoded-sub>/enrollments"` — you want at least one `type=push, status=confirmed` entry. If there isn't one, re-enroll via the Auth0 dashboard's MFA tab.

## Files

| Path | What it does |
|---|---|
| `lib/auth0-ai.ts` | `withGmailRead` (Token Vault) + `withShopBuyApproval` (CIBA wrapper) + `sanitizeBindingMessage` |
| `lib/ai/tools/buy-product.ts` | The wrapped tool — `getAsyncAuthorizationCredentials()` inside `execute` |
| `app/api/cron/check-watchlists/route.ts` | Calls `setAIContext({ threadID: watch.id })` per watch before `generateText` |
| `docs/demos/ciba-watchlist.md` | Demo runbook — talking points, recovery, FAQ |
