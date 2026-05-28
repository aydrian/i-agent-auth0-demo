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

export const buyProduct = (params: BuyProductParams) => {
  const withApproval = withShopBuyApproval({
    watchId: params.watchId,
    userId: params.userId,
    currentPrice: params.currentPrice,
  });

  return withApproval(
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
    })
  );
};
