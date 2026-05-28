import { tool } from "ai";
import { z } from "zod";
import {
  CibaApprovalError,
  requestCibaApproval,
} from "@/lib/auth0-ciba";
import {
  setWatchNotified,
  setWatchPurchased,
} from "@/lib/db/queries/watchlist";
import { placeOrderWithToken } from "@/lib/shop-api-client";

export type BuyProductParams = {
  watchId: string;
  userId: string;
  productId: string;
  currentPrice: number;
};

/**
 * In-cron purchase tool. Fires CIBA directly via `requestCibaApproval`
 * (no SDK wrapper) so we get a real Guardian push the user must approve.
 *
 * The `@auth0/ai-vercel` `withAsyncAuthorization` wrapper is designed for
 * in-chat interrupt flows — it relies on chat-side infrastructure to catch
 * an interrupt, surface the push, and resume the tool. There's no chat in
 * cron; the wrapper short-circuited and silently bypassed CIBA. Going
 * direct against `/bc-authorize` + `/oauth/token` is the correct path
 * here.
 */
export const buyProduct = (params: BuyProductParams) =>
  tool({
    description:
      "Send the user a one-tap approval request for this purchase. Returns the order details when the user approves; throws if they decline or the request expires. The bindingMessage is the single sentence the user sees while deciding — make it explain price and any relevant context. The tool handles authentication and order placement internally; you do not need any credentials of your own.",
    inputSchema: z.object({
      bindingMessage: z
        .string()
        .min(1)
        .max(64)
        .describe(
          "One concise sentence (MAX 64 CHARACTERS) shown to the user when deciding whether to approve. Include the price; keep it tight. Auth0 CIBA rejects binding messages longer than 64 chars."
        ),
      qty: z.number().int().positive().default(1),
    }),
    execute: async ({ bindingMessage, qty }) => {
      // Mark "notified" the moment we kick off the push so a process kill
      // mid-flight rolls back via the cron's 90s stall reset rather than
      // leaving the row inconsistent.
      await setWatchNotified(params.watchId, params.currentPrice);

      let accessToken: string;
      try {
        const approved = await requestCibaApproval({
          userId: params.userId,
          bindingMessage,
          scopes: ["openid", "product:buy"],
          audience: requireEnv("SHOP_API_AUDIENCE"),
        });
        accessToken = approved.accessToken;
      } catch (err) {
        // Surface CibaApprovalError so the cron's catch block can map
        // access_denied/expired_token/timeout to the `denied` outcome.
        if (err instanceof CibaApprovalError) {
          throw err;
        }
        throw err;
      }

      const order = await placeOrderWithToken(
        params.productId,
        qty,
        accessToken
      );
      await setWatchPurchased({
        id: params.watchId,
        orderId: order.orderId,
        purchasedPrice: params.currentPrice,
        purchaseDetails: order,
      });
      return { ok: true, orderId: order.orderId };
    },
  });

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return v;
}
