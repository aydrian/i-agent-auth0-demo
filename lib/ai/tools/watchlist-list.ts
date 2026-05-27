import { tool } from "ai";
import { z } from "zod";
import {
  listUnacknowledgedPurchases,
  listWatchesForUser,
  markPurchasesAcknowledged,
} from "@/lib/db/queries/watchlist";

export const watchlistList = ({ userId }: { userId: string }) =>
  tool({
    description:
      "Return the user's watchlist state: active watches, unacknowledged auto-purchases (call this to surface them), and recently denied entries. Calling this MARKS unacknowledged purchases as acknowledged — only call when the user is asking about the watchlist or when proactively surfacing prior auto-purchases.",
    inputSchema: z.object({}),
    execute: async () => {
      const all = await listWatchesForUser(userId);

      const active = all
        .filter((w) => w.status === "active" || w.status === "notified")
        .map((w) => ({
          id: w.id,
          productId: w.productId,
          productName: w.productName,
          targetPrice: Number(w.targetPrice),
          status: w.status,
          lastSeenPrice: w.lastSeenPrice ? Number(w.lastSeenPrice) : null,
        }));

      const recentlyDenied = all
        .filter((w) => w.status === "denied" || w.status === "error")
        .map((w) => ({
          id: w.id,
          productName: w.productName,
          status: w.status,
          notifiedAt: w.notifiedAt,
        }));

      const purchases = await listUnacknowledgedPurchases(userId);
      const unacknowledgedPurchases = purchases.map((w) => {
        const details = (w.purchaseDetails ?? {}) as {
          orderId?: string;
          product?: { id: string; name: string; pricePerUnit?: number };
          qty?: number;
          subtotal?: number;
          tax?: number;
          total?: number;
          estimatedDelivery?: string;
        };
        return {
          watchId: w.id,
          orderId: w.orderId ?? details.orderId ?? "",
          product: {
            id: details.product?.id ?? w.productId,
            name: details.product?.name ?? w.productName,
          },
          qty: details.qty ?? 1,
          originalPrice: details.product?.pricePerUnit ?? null,
          purchasedPrice: w.purchasedPrice ? Number(w.purchasedPrice) : null,
          subtotal: details.subtotal ?? null,
          tax: details.tax ?? null,
          total: details.total ?? null,
          estimatedDelivery: details.estimatedDelivery ?? null,
        };
      });

      if (purchases.length > 0) {
        await markPurchasesAcknowledged(purchases.map((p) => p.id));
      }

      return { active, unacknowledgedPurchases, recentlyDenied };
    },
  });
