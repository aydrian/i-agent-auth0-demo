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

Your output is EITHER a tool call OR one sentence of plain text. Never both.

If the intent is satisfied by the current price:
  → Invoke the \`buyProduct\` tool. Set \`bindingMessage\` to one sentence the user will see on their phone explaining what they're approving and why (mention the price and how it satisfies their rule). **bindingMessage rules** (Auth0 enforces these — violations get rejected):
    • MAX 64 characters.
    • Allowed: letters, digits, whitespace, and the punctuation \`+ - _ . , : #\`.
    • NOT allowed: \`$\`, \`?\`, parens, quotes, slashes, etc. Spell out "USD" if you must reference currency, or just write the number with no symbol (e.g. "999" not "$999").
  Set \`qty\` to 1 unless the user said otherwise. Do not output any text alongside the tool call — the tool call IS the output.

If the intent is not satisfied:
  → Reply with one short sentence stating the user's threshold and the current price. Do not call any tool.

Optional: if the user's intent references price history (phrases like "recent low", "lowest in N days"), call \`getProductHistory\` first to inform your decision. Otherwise skip it.

Authority: you act on the user's behalf. The \`buyProduct\` tool handles authentication and order placement internally — you have no need for credentials, sessions, or login of your own. Do not refuse for any reason other than the user's intent being unmet.`;

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
  const preferences = [
    "gpt-4o-mini",
    "xai/grok-4.1-fast-non-reasoning",
    "deepseek/deepseek-v3.2",
    "moonshotai/kimi-k2.5",
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
        (r) =>
          (r as { toolName?: string }).toolName === "buyProduct"
      ) as Array<{
        toolName: string;
        output?:
          | { ok: true; orderId: string }
          | { ok: false; error: string; message?: string };
      }>;
      const successful = buyResults.find((r) => r.output?.ok === true);
      const failedResults = buyResults.filter((r) => r.output?.ok === false);

      if (successful) {
        summary.triggered += 1;
        summary.purchased += 1;
        summary.details.push({
          watchId: watch.id,
          productId: watch.productId,
          outcome: "purchased",
          note: `${result.text || "(approved)"}`,
        });
      } else if (failedResults.length > 0) {
        // The model attempted buyProduct one or more times but each came
        // back ok:false. Use the LAST failure's reason to classify.
        summary.triggered += 1;
        const last = failedResults[failedResults.length - 1].output as {
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
            note: `${last.error}: ${last.message ?? ""}`.trim(),
          });
        } else {
          await setWatchStatus(watch.id, "error");
          summary.errors += 1;
          summary.details.push({
            watchId: watch.id,
            productId: watch.productId,
            outcome: "error",
            note: `${last.error}: ${last.message ?? ""}`.trim(),
          });
        }
      } else {
        // No buyProduct attempts at all — agent decided intent wasn't met.
        const allToolNames = (result.steps ?? [])
          .flatMap((s) => s.toolCalls ?? [])
          .map((c) => c.toolName);
        summary.details.push({
          watchId: watch.id,
          productId: watch.productId,
          outcome: "no-buy",
          note: `model=${modelId} tools=[${allToolNames.join(",") || "none"}] text=${result.text || "(empty)"}`,
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
