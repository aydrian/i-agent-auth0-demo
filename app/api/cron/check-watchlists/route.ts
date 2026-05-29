import { setAIContext } from "@auth0/ai-vercel";
import { generateText, stepCountIs } from "ai";
import { type NextRequest, NextResponse } from "next/server";
import { allowedModelIds, DEFAULT_CHAT_MODEL } from "@/lib/ai/models";
import { getLanguageModel } from "@/lib/ai/providers";
import { buyProduct } from "@/lib/ai/tools/buy-product";
import { getProductHistory } from "@/lib/ai/tools/get-product-history";
import {
  listActiveWatches,
  resetAgedDeniedAndErrorWatches,
  resetStalledNotifiedWatches,
  setWatchStatus,
} from "@/lib/db/queries/watchlist";
import { type ShopSearchResult, searchProduct } from "@/lib/shop-api-client";

export const maxDuration = 60;

const STALL_RESET_MS = 90_000;
const COOLDOWN_RESET_MS = 24 * 60 * 60 * 1000;

const AGENT_SYSTEM_PROMPT = `You decide whether to buy a product on behalf of the user.

Input: a product, its current price, and the user's intent (their rule for when to buy).

# Your job

Decide one thing: does the current price satisfy the user's intent RIGHT NOW?

- If YES → first call \`getProductHistory\` to ground your decision in real data, then call \`buyProduct\`. The two tool calls together ARE your answer. Do NOT write text describing the situation — describing it does nothing for the user. Acting is the only way to help them.
- If NO → write one short sentence stating the user's rule and the current price, optionally referencing history if you've already looked it up. Do NOT call \`buyProduct\`.

# Translating intent to a comparison

Map the user's English to a numeric check, then evaluate it against the current price:

- "below $X" / "under $X" / "drops below $X" → satisfied when current < X
- "at or below $X" / "$X or less" → satisfied when current <= X
- "X% off" / "X% discount" → satisfied when current <= MSRP * (1 - X/100)
- "matches recent low" / "lowest in N days" → MUST call \`getProductHistory\` first, then satisfied when current <= recent low

If the comparison evaluates to true on the numbers in front of you, the intent IS satisfied — call \`buyProduct\`. Do not second-guess, do not wait for a "better" deal, do not describe the outcome in text instead of calling the tool.

# Calling buyProduct

- \`qty\`: 1 unless the user said otherwise.
- \`bindingMessage\`: one sentence (MAX 64 chars) shown on the user's phone. MUST include three things in this order:
    1. Product (abbreviate freely — "iPhone 15 Pro" → "iPhone Pro" is fine if needed)
    2. Current price in USD
    3. A reference to BOTH the rule AND what history showed (this is non-negotiable — the user's whole point is seeing that you checked history)
  Good examples (all under 64 chars):
    - \`iPhone Pro 999 USD: under 1000, matches 14-day low.\` (51)
    - \`iPhone Pro 999 USD: 14d low was 950, near low.\` (45)
    - \`iPhone Pro 999 USD: under 1000, lowest in 14d.\` (46)
  Bad (no history reference): \`iPhone 15 Pro at 999 USD: below 1000 limit.\`
  - Allowed chars: letters, digits, whitespace, and \`+ - _ . , : #\`.
  - NOT allowed: \`$\`, \`?\`, parens, quotes, slashes. Spell out "USD" or just write the number — \`999\` not \`$999\`. Auth0 rejects messages that violate these rules.

# Always check price history before buying

Before any \`buyProduct\` call, you MUST call \`getProductHistory\` first. Reasons:
- The user wants to see that the agent considered real data, not just compared two numbers.
- History may reveal a notable recent low you can mention in the \`bindingMessage\` so the user can decide informedly.
- For history-referencing intents (e.g. "matches recent low", "lowest in N days"), history IS the rule — you cannot evaluate without it.

The only case where you skip \`getProductHistory\` is when intent is NOT satisfied — then no buy happens and history is irrelevant.

When you do call \`buyProduct\` after history, the \`bindingMessage\` should reference what you saw — e.g. "iPhone 15 Pro at 999 USD: matches 14-day low." or "iPhone at 999 USD: below 1000 limit, near recent low.".

# Worked examples

Example 1 — intent satisfied, MUST call BOTH tools in order:
  Input: Product=iPhone 15 Pro, Current price=999, User intent="below $1000"
  Comparison: 999 < 1000 → TRUE → satisfied
  Step 1: call \`getProductHistory({ days: 14 })\` and read the result.
  Step 2: call \`buyProduct({ qty: 1, bindingMessage: "iPhone 15 Pro at 999 USD: below 1000 limit, near 14-day low." })\` — referencing what history showed.
  WRONG: skipping \`getProductHistory\` and going straight to \`buyProduct\`. WRONG: writing "Current price is 999, which is below the 1000 threshold." — that's describing, not acting. The user does not see this text.

Example 2 — intent not satisfied, write text:
  Input: Product=iPhone 15 Pro, Current price=1199, User intent="below $1000"
  Comparison: 1199 < 1000 → FALSE → not satisfied
  Correct action: reply "Current price 1199 USD is above your 1000 USD threshold." (no tool call)

# Authority

You act on the user's behalf. The \`buyProduct\` tool handles authentication and order placement internally — you have no credentials, sessions, or login of your own to worry about. Do not refuse for any reason other than the user's intent being unmet.`;

type TickSummary = {
  checked: number;
  triggered: number;
  purchased: number;
  denied: number;
  errors: number;
  details: Array<{
    watchId: string;
    productId: string;
    outcome: "no-buy" | "purchased" | "denied" | "error";
    note?: string;
  }>;
};

function pickAgentModel(): string {
  // Allow ad-hoc override from .env.local for experiments.
  const override = process.env.AGENT_MODEL;
  if (override && allowedModelIds.has(override)) {
    return override;
  }
  // Preference order: tool-call-friendly models first. Some models (notably
  // gpt-5.4-mini) have built-in safety bias against purchase flows that
  // makes them refuse to call `buyProduct` even when explicitly told to;
  // the chat default is the LAST resort, not the first.
  // grok-4.1-fast-non-reasoning was observed to describe the situation in
  // text instead of acting even when intent was clearly met, so it's
  // demoted below models that act more reliably on this prompt shape.
  const preferences = [
    "openai/gpt-oss-120b",
    "deepseek/deepseek-v3.2",
    "moonshotai/kimi-k2.5",
    "openai/gpt-oss-20b",
    "xai/grok-4.1-fast-non-reasoning",
  ];
  for (const id of preferences) {
    if (allowedModelIds.has(id)) {
      return id;
    }
  }
  return DEFAULT_CHAT_MODEL;
}

function buildWatchPrompt(
  watch: { productName: string; intent: string },
  priced: ShopSearchResult
): string {
  const msrp = priced.product.pricePerUnit.toFixed(2);
  const sale = priced.product.salePrice;
  const currentPrice =
    sale != null ? sale.toFixed(2) : priced.product.pricePerUnit.toFixed(2);
  const onSale = sale != null && sale < priced.product.pricePerUnit;
  return [
    `Product: ${watch.productName}`,
    `Current price: $${currentPrice}${onSale ? ` (sale; MSRP $${msrp})` : ""}`,
    `User intent: "${watch.intent}"`,
    "",
    "Decide whether the user's intent is satisfied right now. If yes, call buyProduct. If not, return a short text explanation.",
  ].join("\n");
}

export async function POST(request: NextRequest) {
  const auth = request.headers.get("authorization");
  const expected = `Bearer ${process.env.CRON_SECRET ?? ""}`;
  if (!process.env.CRON_SECRET || auth !== expected) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  if (!process.env.SHOP_API_AUDIENCE) {
    return NextResponse.json(
      { error: "SHOP_API_AUDIENCE not set" },
      { status: 500 }
    );
  }

  await resetStalledNotifiedWatches(STALL_RESET_MS);
  await resetAgedDeniedAndErrorWatches(COOLDOWN_RESET_MS);

  const watches = await listActiveWatches();
  const summary: TickSummary = {
    checked: watches.length,
    triggered: 0,
    purchased: 0,
    denied: 0,
    errors: 0,
    details: [],
  };

  const modelId = pickAgentModel();
  const priceCache = new Map<string, ShopSearchResult>();

  for (const watch of watches) {
    let priced = priceCache.get(watch.productId);
    if (!priced) {
      try {
        priced = await searchProduct(watch.productId, 1);
        priceCache.set(watch.productId, priced);
      } catch (err) {
        summary.errors += 1;
        summary.details.push({
          watchId: watch.id,
          productId: watch.productId,
          outcome: "error",
          note: `shop search failed: ${(err as Error).message}`,
        });
        continue;
      }
    }

    const currentPrice =
      priced.product.salePrice ?? priced.product.pricePerUnit;

    const tools = {
      getProductHistory: getProductHistory({ productId: watch.productId }),
      buyProduct: buyProduct({
        watchId: watch.id,
        userId: watch.userId,
        productId: watch.productId,
        currentPrice,
      }),
    };

    // The wrapped buyProduct tool requires AI context to be visible to the
    // model. Use the watch.id as a synthetic threadID — we're not in chat,
    // but the wrapper needs *some* context to register against.
    setAIContext({ threadID: watch.id });

    try {
      const result = await generateText({
        model: getLanguageModel(modelId),
        system: AGENT_SYSTEM_PROMPT,
        prompt: buildWatchPrompt(watch, priced),
        stopWhen: stepCountIs(3),
        temperature: 0,
        tools,
      });

      // The buyProduct tool returns a structured `{ ok, ... }` instead of
      // throwing on CIBA failure. We look at tool *results* (across all
      // steps; the SDK reports them per-step) to classify the outcome.
      const allToolResults = (result.steps ?? []).flatMap(
        (s) => (s as { toolResults?: unknown[] }).toolResults ?? []
      );
      const buyResults = allToolResults.filter(
        (r) => (r as { toolName?: string }).toolName === "buyProduct"
      ) as Array<{
        toolName: string;
        output?:
          | { ok: true; orderId: string }
          | { ok: false; error: string; message?: string };
      }>;
      const successful = buyResults.find((r) => r.output?.ok === true);
      const failedResults = buyResults.filter((r) => r.output?.ok === false);

      // Show every tool the agent called, including history lookups, so we
      // can see at a glance whether the agent consulted price history.
      const toolsCalled = (result.steps ?? [])
        .flatMap((s) => s.toolCalls ?? [])
        .map((c) => c.toolName);
      const toolsTag = `tools=[${toolsCalled.join(",") || "none"}]`;

      // Surface the bindingMessage the model sent to Auth0 — useful for
      // verifying the model is actually referencing history in the push.
      const buyCall = (result.steps ?? [])
        .flatMap((s) => s.toolCalls ?? [])
        .find((c) => c.toolName === "buyProduct") as
        | { input?: { bindingMessage?: string } }
        | undefined;
      const bindingTag = buyCall?.input?.bindingMessage
        ? ` binding="${buyCall.input.bindingMessage}"`
        : "";

      if (successful) {
        summary.triggered += 1;
        summary.purchased += 1;
        summary.details.push({
          watchId: watch.id,
          productId: watch.productId,
          outcome: "purchased",
          note: `${toolsTag}${bindingTag} ${result.text || "(approved)"}`,
        });
      } else if (failedResults.length > 0) {
        // The model attempted buyProduct one or more times but each came
        // back ok:false. Use the LAST failure's reason to classify.
        summary.triggered += 1;
        const last = failedResults.at(-1)?.output as {
          ok: false;
          error: string;
          message?: string;
        };
        const isDenied =
          last.error === "access_denied" ||
          last.error === "expired_token" ||
          last.error === "timeout";
        if (isDenied) {
          await setWatchStatus(watch.id, "denied");
          summary.denied += 1;
          summary.details.push({
            watchId: watch.id,
            productId: watch.productId,
            outcome: "denied",
            note: `${toolsTag} ${last.error}: ${last.message ?? ""}`.trim(),
          });
        } else {
          await setWatchStatus(watch.id, "error");
          summary.errors += 1;
          summary.details.push({
            watchId: watch.id,
            productId: watch.productId,
            outcome: "error",
            note: `${toolsTag} ${last.error}: ${last.message ?? ""}`.trim(),
          });
        }
      } else {
        // No buyProduct attempts at all — agent decided intent wasn't met.
        summary.details.push({
          watchId: watch.id,
          productId: watch.productId,
          outcome: "no-buy",
          note: `model=${modelId} ${toolsTag} text=${result.text || "(empty)"}`,
        });
      }
    } catch (err) {
      // CIBA denial / expiry / network all surface here from the SDK's
      // blocking polling. Map to denied/error like the deterministic
      // version did.
      const message = (err as Error).message ?? String(err);
      const isDenied =
        message.includes("access_denied") ||
        message.includes("expired_token") ||
        message.includes("timeout");
      if (isDenied) {
        await setWatchStatus(watch.id, "denied");
        summary.triggered += 1;
        summary.denied += 1;
        summary.details.push({
          watchId: watch.id,
          productId: watch.productId,
          outcome: "denied",
          note: message,
        });
      } else {
        await setWatchStatus(watch.id, "error");
        summary.errors += 1;
        summary.details.push({
          watchId: watch.id,
          productId: watch.productId,
          outcome: "error",
          note: message,
        });
      }
    }
  }

  return NextResponse.json(summary);
}

export function GET(request: NextRequest) {
  return POST(request);
}
