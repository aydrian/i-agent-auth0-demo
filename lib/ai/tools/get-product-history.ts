import { tool } from "ai";
import { z } from "zod";
import { fetchProductHistory } from "@/lib/shop-api-client";

export const getProductHistory = ({ productId }: { productId: string }) =>
  tool({
    description: "Get the last N days of price snapshots for this product.",
    inputSchema: z.object({
      days: z.number().int().min(1).max(30).default(14),
    }),
    execute: async ({ days }) => fetchProductHistory(productId, days),
  });
