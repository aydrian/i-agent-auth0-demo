import { type NextRequest, NextResponse } from "next/server";
import { CibaApprovalError, requestCibaApproval } from "@/lib/auth0-ciba";
import {
  listActiveWatches,
  resetAgedDeniedAndErrorWatches,
  resetStalledNotifiedWatches,
  setWatchNotified,
  setWatchPurchased,
  setWatchStatus,
} from "@/lib/db/queries/watchlist";
import {
  placeOrderWithToken,
  type ShopSearchResult,
  searchProduct,
} from "@/lib/shop-api-client";

export const maxDuration = 60;

const STALL_RESET_MS = 90_000;
const COOLDOWN_RESET_MS = 24 * 60 * 60 * 1000;

type TickSummary = {
  checked: number;
  triggered: number;
  purchased: number;
  denied: number;
  errors: number;
  details: Array<{
    watchId: string;
    productId: string;
    outcome: "no-drop" | "purchased" | "denied" | "error";
    note?: string;
  }>;
};

export async function POST(request: NextRequest) {
  const auth = request.headers.get("authorization");
  const expected = `Bearer ${process.env.CRON_SECRET ?? ""}`;
  if (!process.env.CRON_SECRET || auth !== expected) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
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

  const audience = process.env.SHOP_API_AUDIENCE;
  if (!audience) {
    return NextResponse.json(
      { error: "SHOP_API_AUDIENCE not set" },
      { status: 500 }
    );
  }

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
    const target = Number(watch.targetPrice);

    if (currentPrice > target) {
      summary.details.push({
        watchId: watch.id,
        productId: watch.productId,
        outcome: "no-drop",
      });
      continue;
    }

    summary.triggered += 1;
    await setWatchNotified(watch.id, currentPrice);

    const bindingMessage = `Buy 1x ${priced.product.name} at $${currentPrice.toFixed(2)} (was $${priced.product.pricePerUnit.toFixed(2)})?`;

    let accessToken: string;
    try {
      const approved = await requestCibaApproval({
        userId: watch.userId,
        bindingMessage,
        scopes: ["openid", "product:buy"],
        audience,
      });
      accessToken = approved.accessToken;
    } catch (err) {
      if (
        err instanceof CibaApprovalError &&
        (err.reason === "access_denied" ||
          err.reason === "expired_token" ||
          err.reason === "timeout")
      ) {
        await setWatchStatus(watch.id, "denied");
        summary.denied += 1;
        summary.details.push({
          watchId: watch.id,
          productId: watch.productId,
          outcome: "denied",
          note: err.reason,
        });
        continue;
      }
      await setWatchStatus(watch.id, "error");
      summary.errors += 1;
      summary.details.push({
        watchId: watch.id,
        productId: watch.productId,
        outcome: "error",
        note: (err as Error).message,
      });
      continue;
    }

    try {
      const order = await placeOrderWithToken(watch.productId, 1, accessToken);
      await setWatchPurchased({
        id: watch.id,
        orderId: order.orderId,
        purchasedPrice: currentPrice,
        purchaseDetails: order,
      });
      summary.purchased += 1;
      summary.details.push({
        watchId: watch.id,
        productId: watch.productId,
        outcome: "purchased",
        note: order.orderId,
      });
    } catch (err) {
      await setWatchStatus(watch.id, "error");
      summary.errors += 1;
      summary.details.push({
        watchId: watch.id,
        productId: watch.productId,
        outcome: "error",
        note: `order failed: ${(err as Error).message}`,
      });
    }
  }

  return NextResponse.json(summary);
}

export function GET(request: NextRequest) {
  return POST(request);
}
