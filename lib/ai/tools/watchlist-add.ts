import { tool } from "ai";
import { z } from "zod";
import { createWatch } from "@/lib/db/queries/watchlist";
import { searchProduct } from "@/lib/shop-api-client";

export const watchlistAdd = ({ userId }: { userId: string }) =>
  tool({
    description:
      "Add a product to the user's price-drop watchlist. Pass a natural product query (e.g. 'iPhone 15 Pro') and a target price. The agent will be notified via Auth0 Guardian push when the product reaches or falls below the target, and on approval the order will be placed automatically.",
    inputSchema: z.object({
      productQuery: z
        .string()
        .min(1)
        .describe("Product name or keyword (fuzzy match)."),
      targetPrice: z
        .number()
        .positive()
        .describe("Notify when the price is at or below this value (USD)."),
    }),
    execute: async ({ productQuery, targetPrice }) => {
      const result = await searchProduct(productQuery, 1);
      const watch = await createWatch({
        userId,
        productId: result.product.id,
        productName: result.product.name,
        targetPrice,
      });

      return {
        watchId: watch.id,
        product: result.product,
        targetPrice,
        currentPrice: result.product.salePrice ?? result.product.pricePerUnit,
        message: `Watching ${result.product.name}. You'll get a Guardian push if it hits $${targetPrice.toFixed(2)} or below.`,
      };
    },
  });
