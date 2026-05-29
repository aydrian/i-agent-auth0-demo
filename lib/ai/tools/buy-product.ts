import { getAsyncAuthorizationCredentials } from "@auth0/ai-vercel";
import { tool } from "ai";
import { z } from "zod";
import { withShopBuyApproval } from "@/lib/auth0-ai";
import { setWatchPurchased } from "@/lib/db/queries/watchlist";
import { placeOrderWithToken } from "@/lib/shop-api-client";

export type BuyProductParams = {
  watchId: string;
  userId: string;
  productId: string;
  currentPrice: number;
};

/**
 * SDK-wrapped variant: lets `@auth0/ai-vercel`'s `withAsyncAuthorization`
 * own the CIBA flow. The wrapper's `bindingMessage` factory in
 * `lib/auth0-ai.ts` sanitizes the LLM's message before sending to Auth0,
 * so binding-message rejections shouldn't happen here.
 *
 * The tool returns a structured `{ ok, ... }` shape so the cron can
 * classify outcomes from tool *results* (not just calls).
 */
export const buyProduct = (params: BuyProductParams) => {
  const withApproval = withShopBuyApproval({
    watchId: params.watchId,
    userId: params.userId,
    currentPrice: params.currentPrice,
  });

  return withApproval(
    tool({
      description:
        "Send the user a one-tap approval request for this purchase. Returns { ok, orderId } on approval; { ok: false, error } if the user declined or the request expired. The bindingMessage is the single sentence the user sees while deciding — keep it concise (MAX 64 chars) and use only letters, numbers, whitespace, and the characters + - _ . , : # (NO $, ?, parens, quotes; Auth0 rejects them). The tool handles authentication and order placement internally; you do not need any credentials of your own.",
      inputSchema: z.object({
        bindingMessage: z
          .string()
          .min(1)
          .max(64)
          .describe(
            "MAX 64 chars. Allowed characters: a-z, A-Z, 0-9, whitespace, and + - _ . , : # (NO $, ?, parens, quotes — Auth0 rejects them)."
          ),
        qty: z.number().int().positive().default(1),
      }),
      execute: async ({ qty }) => {
        try {
          const credentials = getAsyncAuthorizationCredentials();
          const accessToken = credentials?.accessToken;
          if (!accessToken) {
            return {
              ok: false as const,
              error: "no_access_token",
              message: "CIBA wrapper resolved without an access token",
            };
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
          return { ok: true as const, orderId: order.orderId };
        } catch (err) {
          const message = (err as Error).message ?? String(err);
          return {
            ok: false as const,
            error: "execute_failed",
            message,
          };
        }
      },
    })
  );
};
