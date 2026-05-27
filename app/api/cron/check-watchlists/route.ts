import { getAsyncAuthorizationCredentials } from "@auth0/ai-vercel";
import { generateText, stepCountIs, tool } from "ai";
import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { allowedModelIds, DEFAULT_CHAT_MODEL } from "@/lib/ai/models";
import { getLanguageModel } from "@/lib/ai/providers";
import { withShopBuyApproval } from "@/lib/auth0-ai";
import {
  listActiveWatches,
  resetAgedDeniedAndErrorWatches,
  resetStalledNotifiedWatches,
  setWatchPurchased,
  setWatchStatus,
} from "@/lib/db/queries/watchlist";
import {
  fetchProductHistory,
  placeOrderWithToken,
  type ShopSearchResult,
  searchProduct,
} from "@/lib/shop-api-client";

export const maxDuration = 60;

const STALL_RESET_MS = 90_000;
const COOLDOWN_RESET_MS = 24 * 60 * 60 * 1000;

const AGENT_SYSTEM_PROMPT = `You are a purchase-decision agent acting on behalf of a user.

For the watchlist row you are given, decide whether the user's intent is satisfied by the current state of the product.

You have two tools:
- \`getProductHistory({ days })\` — returns recent daily price snapshots. Use this only when the user's intent references history (e.g. "matches recent low", "not seen lower in 30 days"). Otherwise skip it.
- \`buyProduct({ bindingMessage, qty })\` — initiates an Auth0 Guardian push to the user with your binding message and, on approval, places the order. Compose the bindingMessage as a single concise sentence (the user sees it on their phone) that explains why you're asking now. Mention the price and any history-derived nuance ("recent low was $X").

If the user's intent is satisfied, call \`buyProduct\`. If not, simply respond with a short text explaining why and do not call any tool — the watch row will stay active for the next tick.

Examples of good binding messages:
- "Buy iPhone 15 Pro at $999? Below your $1000 target."
- "Buy iPhone 15 Pro at $999? Recent low was $950 last week — you might want to wait."

Do not buy unless the intent is met. Do not narrate your reasoning in chat — your only output is either a tool call or a short refusal.`;

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

    const withApproval = withShopBuyApproval({
      watchId: watch.id,
      userId: watch.userId,
      currentPrice,
    });

    const buyProduct = withApproval(
      tool({
        description:
          "Ask the user to approve buying this product via Auth0 Guardian push. Returns the order on approval; throws on denial/expiry. Compose the bindingMessage to explain to the user (on their phone) why you're asking now.",
        inputSchema: z.object({
          bindingMessage: z
            .string()
            .min(1)
            .describe(
              "One concise sentence shown on Guardian. Include price and any history nuance."
            ),
          qty: z.number().int().positive().default(1),
        }),
        execute: async ({ qty }) => {
          const credentials = getAsyncAuthorizationCredentials();
          const accessToken = credentials?.accessToken;
          if (!accessToken) {
            throw new Error("CIBA approval did not produce an access token");
          }
          const order = await placeOrderWithToken(
            watch.productId,
            qty,
            accessToken
          );
          await setWatchPurchased({
            id: watch.id,
            orderId: order.orderId,
            purchasedPrice: currentPrice,
            purchaseDetails: order,
          });
          return { ok: true, orderId: order.orderId };
        },
      })
    );

    const getProductHistoryTool = tool({
      description: "Get the last N days of price snapshots for this product.",
      inputSchema: z.object({
        days: z.number().int().min(1).max(30).default(14),
      }),
      execute: async ({ days }) => fetchProductHistory(watch.productId, days),
    });

    try {
      const result = await generateText({
        model: getLanguageModel(modelId),
        system: AGENT_SYSTEM_PROMPT,
        prompt: buildWatchPrompt(watch, priced),
        stopWhen: stepCountIs(3),
        temperature: 0,
        tools: {
          getProductHistory: getProductHistoryTool,
          buyProduct,
        },
      });

      const calledBuy = (result.toolCalls ?? []).some(
        (c) => c.toolName === "buyProduct"
      );

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
        summary.details.push({
          watchId: watch.id,
          productId: watch.productId,
          outcome: "no-buy",
          note: result.text || "(no decision text)",
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
