import { tool } from "ai";
import { z } from "zod";
import { createWatch } from "@/lib/db/queries/watchlist";
import { searchProduct } from "@/lib/shop-api-client";

export const watchlistAdd = ({ userId }: { userId: string }) =>
  tool({
    description:
      "Add a product to the user's price-drop watchlist. Pass a natural product query (e.g. 'iPhone 15 Pro') and the user's free-form buying intent (e.g. 'price drops below $1000', 'matches recent low'). A background agent will check periodically; when it decides the user's intent is met, it will request approval via Auth0 Guardian push and auto-purchase on approval.",
    inputSchema: z.object({
      productQuery: z
        .string()
        .min(1)
        .describe("Product name or keyword (fuzzy match)."),
      intent: z
        .string()
        .min(1)
        .describe(
          "The user's free-form rule for when to buy in their own words " +
            "(e.g. 'price drops below $1000', 'matches recent low', 'on sale " +
            "and not seen lower in 30 days'). Capture the user's actual condition; " +
            "do NOT normalize it into a number."
        ),
    }),
    execute: async ({ productQuery, intent }) => {
      const result = await searchProduct(productQuery, 1);
      const watch = await createWatch({
        userId,
        productId: result.product.id,
        productName: result.product.name,
        intent,
      });

      return {
        watchId: watch.id,
        product: result.product,
        intent,
        currentPrice: result.product.salePrice ?? result.product.pricePerUnit,
        message: `Watching ${result.product.name}. The agent will check periodically and ask for your approval via Guardian when your condition (${intent}) is met.`,
      };
    },
  });
