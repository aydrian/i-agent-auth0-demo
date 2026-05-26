# `@auth0/ai-vercel` `useInterruptions().resume()` leaks the `continueInterruption` marker

## Summary

After a Token Vault interrupt is resolved (user authorizes via popup, `interrupt.resume()` fires), the synthetic tool-result part stamped with `output.continueInterruption: true` is never cleared from the message tree. This single root cause produces two distinct user-visible bugs:

1. **Infinite resubmit loop.** The chat client fires an unbounded sequence of empty `POST /api/chat` requests. Each consumes an LLM call until the AI Gateway rate-limits the user (HTTP 429 / `rate_limit_exceeded`), at which point the chat collapses with `AI_NoOutputGeneratedError`.
2. **Duplicated tool render.** After the resume completes, the assistant message contains both the synthetic `continueInterruption` part *and* the real tool-output part for the same `toolCallId`. The UI renders both — a "Running" placeholder above the actual result card.

Both bugs only occur on the first interrupt-resume cycle within a chat session. Subsequent prompts on the same chat (where the OAuth token is already cached, so no interrupt fires) work correctly.

## Affected versions

- `@auth0/ai-vercel@5.1.1`
- `@auth0/ai@6.0.2`
- `ai@6.0.116`
- `@ai-sdk/react@3.0.118`

Stack: Next.js 16 App Router, AI SDK v6 `useChat` wrapped by `useInterruptions`.

## Reproduction

1. Set up a tool that throws `TokenVaultInterrupt` (e.g. a `gmailSearch` tool wrapped with `withTokenVault({ connection: "google-oauth2", scopes: [...] })`).
2. Render the chat with `useInterruptions(() => useChat({ ... sendAutomaticallyWhen: ... }))` following the documented pattern. A representative `sendAutomaticallyWhen` predicate (this is what the docs/examples lead consumers to write):

   ```ts
   sendAutomaticallyWhen: ({ messages }) => {
     const last = messages.at(-1);
     return last?.parts?.some((part) => {
       if (!("state" in part)) return false;
       if (
         part.state === "approval-responded" &&
         (part.approval as { approved?: boolean })?.approved === true
       ) {
         return true;
       }
       if (
         part.state === "output-available" &&
         part.type?.startsWith("tool-") &&
         (part.output as { continueInterruption?: boolean })
           ?.continueInterruption === true
       ) {
         return true;
       }
       return false;
     }) ?? false;
   };
   ```

3. Send a prompt that triggers the tool with no cached token (first interrupt path).
4. Authorize in the popup. The tool runs successfully and the assistant streams a final response.
5. **Bug #1 (resubmit loop):** Observe the network tab — `/api/chat` is POSTed repeatedly with empty bodies until the AI Gateway returns 429.
6. **Bug #2 (duplicated render):** Observe the assistant message — a "Running" `gmailSearch` tool placeholder shows directly above the real result card (e.g. `Emails (1)`). Both correspond to the same `toolCallId`.

## Root cause

In `@auth0/ai-vercel/dist/esm/react/interrupts.js` the `resume()` callback returned from `useInterruptions` calls `addToolResult` with a synthetic output that sets `continueInterruption: true`:

```js
// node_modules/@auth0/ai-vercel/dist/esm/react/interrupts.js
resume: (result) => {
  setToolInterrupt(null);
  if (parsedError?.behavior === "reload") {
    regenerate();
  } else {
    addToolResult({
      tool: parsedError.toolCall?.name,
      toolName: parsedError.toolCall?.name,
      toolCallId: id,
      output: {
        continueInterruption: true,
        toolName: parsedError.toolCall?.name,
        ...result,
      },
    });
  }
},
```

This marker (`output.continueInterruption === true`) is the contract the SDK relies on to tell the consumer "please re-submit so the server can run the tool for real." Consumers wire that into `sendAutomaticallyWhen` per the docs.

The problem: **nothing in the SDK ever clears that marker.** After the resume POST completes, the conversation contains both:

- The synthetic part stamped by `addToolResult` (`state: "output-available"`, `output.continueInterruption: true`).
- The real tool-output part emitted by the resumed server stream (`state: "output-available"`, `output: <actual tool data>`).

Both share the same `toolCallId`. The two parts can end up either on the same assistant message (if the SDK appends rather than replaces) or on different assistant messages within the same conversation (the resumed stream may emit a fresh assistant message rather than continuing the prior one). Either way, both parts persist and both render.

This drives both bugs:

- **Bug #1 (resubmit loop):** `sendAutomaticallyWhen` is, by AI SDK v6 design, a pure predicate over `messages`. It is invoked every time the chat returns to idle. As long as the synthetic marker is on the message tree, the predicate returns `true` and the SDK fires another empty submission. Loop until rate-limit.
- **Bug #2 (duplicated render):** Renderers iterate `message.parts` and render each tool part independently. With two parts for one tool call, the placeholder and the resolved card both render — the consumer has no signal that the placeholder is now stale.

The `behavior === "reload"` branch is fine because `regenerate()` does not stamp the marker. Only the default `addToolResult` branch is affected.

## Impact

- Burns through AI Gateway free-tier credits on every successful Token Vault auth.
- Surfaces in production as 429 / `AI_NoOutputGeneratedError` and a flickering UI as the empty stream partially renders before failing.
- Visible UI artifact: a "Running" tool placeholder remains above the resolved tool result card after a successful resume.
- Every consumer following the published `useInterruptions` + `sendAutomaticallyWhen` pattern will hit both bugs on first auth in a chat session. Hard to notice in development if the developer's token is already cached.

## Suggested fixes (any one is sufficient; #1 is the smallest contract change)

### 1. Have `useInterruptions` own the `sendAutomaticallyWhen` predicate

Return a ready-made predicate from `useInterruptions` that internally tracks tool-call IDs that have already been auto-fired. Consumers wire it directly into `useChat`:

```ts
const { sendAutomaticallyWhen, ... } = useInterruptions(...);

useChat({
  sendAutomaticallyWhen, // SDK-owned, dedupes by toolCallId
  // ...
});
```

This removes the foot-gun entirely without touching the on-the-wire protocol.

### 2. Clear `continueInterruption` after the resume stream finishes

Watch the chat's `status` transition or attach to `onFinish`, and after the next idle, strip the synthetic part from `messages` (or strip the `continueInterruption` flag from any tool part where it was set). Fixes both bugs simultaneously: the predicate stops matching, and renderers no longer see two parts for one tool call.

### 3. Make `resume()` resubmit directly

The `behavior === "reload"` branch already calls `regenerate()`. The default branch could do the same — call `addToolResult({ output: { continueInterruption: true, ... } })` *and* `regenerate()` (or push through the existing transport) instead of leaving resubmission to a consumer-side predicate. The marker would no longer need to be observable from `sendAutomaticallyWhen` at all. Combined with #2, the synthetic part can be made fully internal to the SDK.

## Consumer-side workarounds

Each bug needs its own guard until the SDK is fixed.

### Workaround for Bug #1 (resubmit loop)

Guard `sendAutomaticallyWhen` with a one-shot `Set` keyed by `toolCallId`:

```tsx
const autoSentToolCallIdsRef = useRef(new Set<string>());

useChat({
  sendAutomaticallyWhen: ({ messages }) => {
    const last = messages.at(-1);
    if (!last?.parts) return false;
    for (const part of last.parts) {
      if (!("state" in part)) continue;
      const toolCallId = (part as { toolCallId?: string }).toolCallId;
      const matches =
        (part.state === "approval-responded" &&
          (part.approval as { approved?: boolean })?.approved === true) ||
        (part.state === "output-available" &&
          part.type?.startsWith("tool-") &&
          (part.output as { continueInterruption?: boolean })
            ?.continueInterruption === true);
      if (!matches) continue;
      if (toolCallId && autoSentToolCallIdsRef.current.has(toolCallId)) continue;
      if (toolCallId) autoSentToolCallIdsRef.current.add(toolCallId);
      return true;
    }
    return false;
  },
  // ...
});
```

This makes the auto-resubmit one-shot per tool call. After firing once, the same `toolCallId` never triggers again, even if the marker remains on the message.

### Workaround for Bug #2 (duplicated render)

**No safe consumer-side workaround was found.** We attempted three approaches and each caused a regression:

1. **Per-message render-time dedupe** (filter parts within `message.parts` before render): the synthetic placeholder and the real tool-output part frequently land on *different* assistant messages, so a per-message scan misses the case and the duplicate keeps showing.
2. **Conversation-wide render-time dedupe** (read all messages from a chat context to build a "resolved tool calls" set, then suppress placeholders for resolved IDs): broke the resume continuation. Best guess: while `useInterruptions`'s `toolInterrupt` is set, it returns *render-time-overridden* messages where the in-flight tool part appears as `output-available` with `output: {state: "output-available"}`. That part has no `continueInterruption` flag, so a generic "real twin" filter matches it and either suppresses the wrong card or feeds back into the resume cycle in a way that prevents the assistant's response from arriving.
3. **`useEffect`-based state cleanup** (watch `messages`, `setMessages` to filter out synthetic and orphan parts once a real twin lands): the cleanup ran during the resumed stream and removed the part the SDK was about to populate with the real tool output. Net effect: assistant text arrives, real result never lands on the client. Strongly suggests the SDK reconciles incoming tool-output stream events by `toolCallId` against the existing part — removing it mid-stream is destructive.

Tying any consumer-side fix to a `status === "ready"` gate would in principle defer cleanup until after the stream finishes, but every approach above already operates on apparently-final state and still misbehaves. The synthetic part is too entangled with the SDK's internal reconciliation for a consumer to safely rewrite it.

We therefore ship with the duplicate placeholder visible. The functional flow (auth, tool execution, real result render, assistant text) is correct; only the redundant "Running" card lingers. **A real fix needs to live in `@auth0/ai-vercel`** — see Suggested fixes above. Fix #2 (clear the marker after the resume stream finishes) addresses both bugs cleanly because the SDK can clean up its own synthetic state with full knowledge of when the stream has reconciled.

## Where this surfaced

Encountered while implementing a Gmail Token Vault demo using `@auth0/ai-vercel` against the AI SDK v6 `useChat` API. Repo / file references on request.
