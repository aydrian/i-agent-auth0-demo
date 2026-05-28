# Why we bypass `@auth0/ai-vercel`'s `withAsyncAuthorization` for cron-driven CIBA

## Summary

The watchlist's cron route needs to fire CIBA pushes **out-of-session** — there is no chat context, no UI, no user thread. We tried to use `@auth0/ai-vercel`'s `withAsyncAuthorization` wrapper (the same SDK call `assistant0-vercel-arize` uses for in-session purchases). It silently bypassed real CIBA: orders went through with `purchased: 1` and **no Guardian push ever fired**. After investigation we replaced the wrapper with a hand-rolled CIBA helper (`lib/auth0-ciba.ts`) that calls Auth0's `/bc-authorize` and `/oauth/token` endpoints directly.

This document captures the failure mode and the rationale, so future maintainers don't try to "clean up" by reintroducing the SDK wrapper.

## What CIBA in this project looks like

The cron route at `app/api/cron/check-watchlists/route.ts` runs on a schedule (or on-demand via `pnpm demo:ciba-watchlist trigger`). For each active watchlist row, it asks an LLM to decide whether the user's intent is met. If so, the LLM calls a `buyProduct` tool. That tool needs to:

1. Send a CIBA push to the user's Guardian-enrolled phone with a binding message.
2. **Block** until the user approves, denies, or the request expires.
3. On approval, use the resulting access token to POST the order to shop-api.
4. On denial/expiry, mark the watch row `denied`.

Crucially, the cron has no chat session, no `<Suspense>` boundary, and no UI hook to present an interrupt. It needs blocking, server-side CIBA polling.

## What we tried (the SDK path)

Mirror `assistant0-vercel-arize` and use `withAsyncAuthorization`:

```ts
// lib/auth0-ai.ts (deleted)
export const withShopBuyApproval = (params: { watchId, userId, currentPrice }) =>
  auth0AI.withAsyncAuthorization({
    userID: async () => params.userId,
    bindingMessage: async ({ bindingMessage }: { bindingMessage: string }) => bindingMessage,
    scopes: ["openid", "product:buy"],
    audience: process.env.SHOP_API_AUDIENCE!,
    onAuthorizationRequest: async (_authReq, creds) => {
      await setWatchNotified(params.watchId, params.currentPrice);
      await creds; // documented as "blocking" when this is a function
    },
  });

// lib/ai/tools/buy-product.ts
export const buyProduct = (params) =>
  withShopBuyApproval(params)(
    tool({
      description: "...",
      inputSchema: z.object({ bindingMessage, qty }),
      execute: async ({ qty }) => {
        const credentials = getAsyncAuthorizationCredentials();
        const order = await placeOrderWithToken(productId, qty, credentials.accessToken);
        return { ok: true, orderId: order.orderId };
      },
    })
  );
```

The SDK source documents two `onAuthorizationRequest` modes (in `node_modules/@auth0/ai/dist/esm/authorizers/async-authorization/AsyncAuthorizerBase.js`):

```js
const interruptMode =
  typeof this.params.onAuthorizationRequest === "undefined" ||
  this.params.onAuthorizationRequest === "interrupt";

if (interruptMode) {
  credentials = await this.getCredentials(authResponse); // throws AuthorizationPendingInterrupt
} else {
  authResponse = await this.start(authorizeParams); // POSTs /bc-authorize
  const credentialsPromise = this.getCredentialsPolling(authResponse);
  if (typeof this.params.onAuthorizationRequest === "function") {
    await this.params.onAuthorizationRequest(authResponse, credentialsPromise);
  }
  credentials = await credentialsPromise; // blocks until /oauth/token resolves
}
```

By passing a function, we should land in the blocking branch. The function receives the `authReq` (with `auth_req_id`) and a `Promise<TokenSet>` that resolves on user approval.

## What actually happened

We instrumented every step. The empirical observations:

### Without `setAIContext`
The wrapped tool was registered in the `tools` object passed to `generateText`, with both `description` and `inputSchema` present:

```
[cron] watch a3a4355c-... { toolKeys: [ 'getProductHistory', 'buyProduct' ],
                            buyProductHasDescription: true,
                            buyProductHasInputSchema: true }
```

But the model never called it. The note showed `tools=[none]` and the model wrote the binding message as plain text. Two different models (gpt-5.4-mini and grok-4.1-fast-non-reasoning) produced the same behavior.

We isolated the cause with a debug flag (`DISABLE_CIBA_WRAPPER=1`) that swapped in an unwrapped stub:

```
[cron] STUB buyProduct invoked { watchId: '...', bindingMessage: '...', qty: 1 }
```

The stub was called by the same model, with the same prompt. **The wrapper was making the tool inert.**

### With `setAIContext({ threadID: watch.id })`

We added `setAIContext` per-watch (using the watch's UUID as a synthetic thread id). Now the model called `buyProduct`, the tool's `execute` ran, the order went through. Response said `purchased: 1` with the LLM-composed binding message in the note.

**But no Guardian push fired.** The user's phone never buzzed.

We added diagnostics to `onAuthorizationRequest`:

```ts
onAuthorizationRequest: async (authReq, creds) => {
  console.log("[ciba] onAuthorizationRequest fired", { authReq });
  await setWatchNotified(...);
  try {
    const resolved = await creds;
    console.log("[ciba] credentials resolved", { hasAccessToken: ..., accessTokenPrefix: ... });
  } catch (err) {
    console.log("[ciba] credentials rejected", { error: ... });
    throw err;
  }
}
```

**The `[ciba]` log lines never appeared.** The hook was a function, the SDK should have invoked it (`typeof === "function"` is truthy), but it didn't. Yet `getAsyncAuthorizationCredentials()` returned a non-empty `accessToken` and `placeOrderWithToken` succeeded.

The shop-api in this demo doesn't validate the JWT — it accepts any `Authorization: Bearer …` header — so the order went through with a stub or stale value the SDK fabricated somewhere along the way.

Net effect: **CIBA was never actually performed**, but the agent and the cron summary both reported success. From the user's point of view: silent purchase, no consent.

## Why we think this happens

We traced through `AsyncAuthorizerBase.protect()` and saw the documented two-branch structure. With our config, the function-branch should run. But on the live SDK with `setAIContext` set, neither branch's hooks fired in a way we could observe.

Best guess (uncertain — would need an Auth0 SDK maintainer to confirm):

- The wrapper has additional state stored against the AI context (the `setAIContext` thread id) that we're not setting up correctly. Without that state, the wrapper can't run a real `/bc-authorize` call but doesn't error — it returns whatever the underlying store has for the thread (in our case, an empty/stub TokenSet).
- The blocking-mode code path documented in the source may be intended for a use case other than ours (e.g., resumed-from-interrupt continuation rather than first-time fresh auth).
- The chat-side tooling that calls `setAIContext` also sets up store entries, interrupt handlers, and resume hooks via `@auth0/ai-vercel/interrupts`. Replicating that without a chat session is non-trivial and undocumented.

The wrapper works perfectly in chat (we use it for Gmail Token Vault — see `lib/auth0-ai.ts`). It does not work in cron.

## Our workaround

`lib/auth0-ciba.ts` is a 190-line helper that implements the CIBA protocol directly:

```ts
export async function requestCibaApproval({
  userId, bindingMessage, scopes, audience, timeoutMs = 90_000
}): Promise<{ accessToken: string }> {
  // 1. POST /bc-authorize with login_hint, binding_message, scope, audience.
  //    Returns { auth_req_id, expires_in, interval }.
  // 2. Sleep `interval` seconds, then POST /oauth/token with
  //    grant_type=urn:openid:params:grant-type:ciba and the auth_req_id.
  // 3. On `authorization_pending`, sleep again. On `slow_down`, bump interval.
  //    On `expired_token` or `access_denied`, throw CibaApprovalError.
  // 4. On 200, return { accessToken }.
}
```

`lib/ai/tools/buy-product.ts` calls it inside `execute` with no SDK wrapper:

```ts
export const buyProduct = (params: BuyProductParams) =>
  tool({
    description: "...",
    inputSchema: z.object({ bindingMessage, qty }),
    execute: async ({ bindingMessage, qty }) => {
      await setWatchNotified(params.watchId, params.currentPrice);
      const { accessToken } = await requestCibaApproval({
        userId: params.userId,
        bindingMessage,
        scopes: ["openid", "product:buy"],
        audience: process.env.SHOP_API_AUDIENCE!,
      });
      const order = await placeOrderWithToken(params.productId, qty, accessToken);
      await setWatchPurchased({ ... });
      return { ok: true, orderId: order.orderId };
    },
  });
```

The cron route registers this unwrapped tool the normal way and runs `generateText`. The model calls `buyProduct`, `execute` blocks on `requestCibaApproval`, the user's phone buzzes, they approve, the helper gets back a real access token, the order happens.

## What we kept on the SDK

`@auth0/ai-vercel` is still used for:

- **Token Vault** (Gmail): `withGmailRead` in `lib/auth0-ai.ts`. This works fine because Gmail is an in-chat tool with full chat infrastructure (interrupts, suspense boundaries, etc.).
- **Future in-chat purchase tool**, if we add one. The wrapper is the right call there — we'd want interrupt mode so the chat UI catches the push prompt.

The decision is per-tool: SDK for chat, hand-rolled for cron. The two coexist.

## When to reconsider

Revisit the SDK path when any of:

1. `@auth0/ai-vercel` ships a documented non-chat blocking mode (e.g., a `polling: true` config option) with an example we can mirror.
2. We discover the missing piece — the right `setAIContext` invocation, store configuration, or other setup that makes the wrapper's blocking branch actually fire `/bc-authorize`.
3. We add a serious dependency on the SDK's CIBA features (e.g., Auth0-managed retries, custom store implementations) that the hand-rolled helper would have to re-implement.

Until then, the hand-rolled helper is shorter, more explicit, easier to debug, and demonstrably works against a real Auth0 tenant.

## Files touched by the workaround

| Path | Role |
|---|---|
| `lib/auth0-ciba.ts` | Hand-rolled CIBA: `requestCibaApproval` + `CibaApprovalError`. |
| `lib/ai/tools/buy-product.ts` | Tool factory; calls `requestCibaApproval` directly inside `execute`. |
| `lib/auth0-ai.ts` | Kept `withGmailRead` (Token Vault). Removed the deleted `withShopBuyApproval`. |
| `app/api/cron/check-watchlists/route.ts` | Registers the unwrapped tool, no `setAIContext`. |

## Reproducing the original failure

If you want to verify the wrapper bypass yourself, the relevant commits are in git history before `f88faec`:

```bash
git show d6eaf67  # original lib/auth0-ciba.ts (subsequently deleted, then restored)
git show bdd943d  # SDK-wrapped buyProduct + setAIContext-less cron
git show 0c863e8  # added setAIContext (made tool callable but bypassed CIBA)
git show d0b2d7e  # diagnostic logs that proved onAuthorizationRequest never fired
git show f88faec  # the fix: bypass the wrapper, restore the helper
```

The diagnostics in `d0b2d7e` are the smoking gun — `onAuthorizationRequest` is configured as a function, the SDK source's `interruptMode` check evaluates to `false`, and yet the function is never invoked while orders still go through.
