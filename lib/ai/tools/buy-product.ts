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
        "Send the user a one-tap approval request for this purchase. Returns the order details when the user approves; throws if they decline or the request expires. The bindingMessage is the single sentence the user sees while deciding — make it explain price and any relevant context. The tool handles authentication and order placement internally; you do not need any credentials of your own.",
      inputSchema: z.object({
        bindingMessage: z
          .string()
          .min(1)
          .describe(
            "One concise sentence shown to the user when deciding whether to approve. Include the price and any relevant nuance."
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
