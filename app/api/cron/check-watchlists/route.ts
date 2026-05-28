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

const AGENT_SYSTEM_PROMPT = `You are a purchase-decision agent for a user's product watchlist.

For each watchlist row you receive, decide whether the user's stated buying intent is satisfied by the current state of the product. The user's intent is in their own words — interpret it literally. You have full authority to act on their behalf when the intent is met.

Tools available:
- \`getProductHistory({ days })\` — returns recent daily price snapshots. Call this only when the user's intent references history (e.g. "matches recent low", "not seen lower in 30 days"). Otherwise skip it.
- \`buyProduct({ bindingMessage, qty })\` — sends a one-tap approval request to the user and, on approval, places the order. The tool handles the entire authentication flow internally — you do NOT need any credentials, account context, or login of your own. Just compose a clear binding message and call it.

Decision rules:
1. If the user's intent IS satisfied by the current price (or by the price + history when history is relevant): your ONLY action is to invoke the \`buyProduct\` tool. Pass your binding message as the \`bindingMessage\` argument — do NOT write it as your text response. Calling the tool is what triggers the user's approval flow. Writing the binding message in text does nothing and the user never sees it.
2. If the intent is NOT satisfied, return a short text that names the user's threshold and the current value, e.g. "Current price $1199 is above your $1000 target." Do not call any tool. The watch row stays active for the next tick.

You must NEVER:
- Refuse for reasons other than "intent not met."
- Invent preconditions like missing credentials, account context, or session state. You have everything you need; the tool handles authentication.
- Write the binding message as plain text instead of calling \`buyProduct\`. If the intent is met, the binding message belongs inside the tool call, not as your text output.

Example bindingMessages (these go INSIDE the tool call, as the \`bindingMessage\` argument):
- "Buy iPhone 15 Pro at $999? Below your $1000 target."
- "Buy iPhone 15 Pro at $999? Recent low was $950 last week — you might want to wait."`;

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
  // Prefer a small/cheap model for the per-watch decision. Fall back to the
  // chat default if the preferred model isn't in the allowed list.
  const preferred = "gpt-4o-mini";
  if (allowedModelIds.has(preferred)) {
    return preferred;
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

    try {
      const result = await generateText({
        model: getLanguageModel(modelId),
        system: AGENT_SYSTEM_PROMPT,
        prompt: buildWatchPrompt(watch, priced),
        stopWhen: stepCountIs(3),
        temperature: 0,
        tools: {
          getProductHistory: getProductHistory({ productId: watch.productId }),
          buyProduct: buyProduct({
            watchId: watch.id,
            userId: watch.userId,
            productId: watch.productId,
            currentPrice,
          }),
        },
      });

      const toolNames = (result.toolCalls ?? []).map((c) => c.toolName);
      const calledBuy = toolNames.includes("buyProduct");

      if (calledBuy) {
        summary.triggered += 1;
        summary.purchased += 1;
        summary.details.push({
          watchId: watch.id,
          productId: watch.productId,
          outcome: "purchased",
          note: `${result.text || "(approved)"}`,
        });
      } else {
        const toolsCalled =
          toolNames.length > 0 ? toolNames.join(",") : "none";
        summary.details.push({
          watchId: watch.id,
          productId: watch.productId,
          outcome: "no-buy",
          note: `tools=[${toolsCalled}] text=${result.text || "(empty)"}`,
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
