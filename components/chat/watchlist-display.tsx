"use client";

import { format, parseISO } from "date-fns";
import {
  AlertCircle,
  CheckCircle2,
  Eye,
  Package,
  ShoppingBag,
} from "lucide-react";

type ProductLite = {
  id: string;
  name: string;
  category: string | null;
  imageUrl: string | null;
};

type UnacknowledgedPurchase = {
  watchId: string;
  orderId: string;
  product: ProductLite;
  qty: number;
  originalPrice: number | null;
  purchasedPrice: number | null;
  subtotal: number | null;
  tax: number | null;
  total: number | null;
  estimatedDelivery: string | null;
};

type ActiveWatch = {
  id: string;
  productId: string;
  productName: string;
  intent: string;
  status: "active" | "notified";
  lastSeenPrice: number | null;
};

type DeniedWatch = {
  id: string;
  productName: string;
  status: "denied" | "error";
  notifiedAt: string | Date | null;
};

type WatchlistResult = {
  active: ActiveWatch[];
  unacknowledgedPurchases: UnacknowledgedPurchase[];
  recentlyDenied: DeniedWatch[];
};

function formatDelivery(value: string | null): string | null {
  if (!value) {
    return null;
  }
  try {
    return format(parseISO(value), "EEEE, LLL d, yyyy");
  } catch {
    return value;
  }
}

function formatMoney(value: number | null): string {
  if (value == null) {
    return "—";
  }
  return value.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
  });
}

function OrderConfirmationCard({ order }: { order: UnacknowledgedPurchase }) {
  const eta = formatDelivery(order.estimatedDelivery);
  const wasPrice = order.originalPrice;
  const paid = order.purchasedPrice;
  const showWasPrice = wasPrice != null && paid != null && wasPrice > paid;

  return (
    <div className="mb-3 rounded-lg border bg-card p-4 shadow-sm">
      <div className="mb-3 flex items-center gap-2 border-b pb-3">
        <CheckCircle2 className="h-5 w-5 text-green-600" />
        <h3 className="font-medium text-sm">Order confirmed</h3>
      </div>

      <div className="mb-4 flex gap-3">
        <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded bg-secondary">
          {order.product.imageUrl ? (
            // shop-api host is external and dynamic; next/image config would
            // need explicit remotePatterns. Plain img is fine for this demo
            // card.
            // biome-ignore lint/performance/noImgElement: see comment above
            <img
              alt={order.product.name}
              className="h-full w-full object-cover"
              src={order.product.imageUrl}
            />
          ) : (
            <ShoppingBag className="h-7 w-7 text-muted-foreground" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-medium text-sm">{order.product.name}</p>
          {order.product.category && (
            <p className="text-muted-foreground text-xs">
              {order.product.category}
            </p>
          )}
          <p className="text-muted-foreground text-xs">
            {showWasPrice && (
              <span className="line-through">{formatMoney(wasPrice)}</span>
            )}
            {showWasPrice && " "}
            {formatMoney(paid)} × {order.qty}
          </p>
        </div>
      </div>

      <div className="mb-4 space-y-2 border-t border-b py-3 text-sm">
        <div className="flex justify-between">
          <span className="text-muted-foreground">Subtotal</span>
          <span>{formatMoney(order.subtotal)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">Tax</span>
          <span>{formatMoney(order.tax)}</span>
        </div>
        <div className="flex justify-between font-medium text-base">
          <span>Total</span>
          <span>{formatMoney(order.total)}</span>
        </div>
      </div>

      <div className="space-y-1 text-xs">
        {eta && (
          <div className="flex items-center gap-2 text-muted-foreground">
            <Package className="h-3.5 w-3.5" />
            <span>Est. delivery: {eta}</span>
          </div>
        )}
        {order.orderId && (
          <p className="text-muted-foreground">Order #{order.orderId}</p>
        )}
      </div>
    </div>
  );
}

function ActiveWatchesSection({ watches }: { watches: ActiveWatch[] }) {
  if (watches.length === 0) {
    return null;
  }
  return (
    <div className="mb-3 rounded-lg border bg-card p-4">
      <div className="mb-2 flex items-center gap-2">
        <Eye className="h-4 w-4 text-muted-foreground" />
        <h3 className="font-medium text-sm">
          Active {watches.length === 1 ? "watch" : "watches"}
        </h3>
      </div>
      <ul className="space-y-1.5 text-sm">
        {watches.map((w) => (
          <li className="flex justify-between gap-2" key={w.id}>
            <span className="truncate">
              <span className="font-medium">{w.productName}</span>
              <span className="text-muted-foreground"> — {w.intent}</span>
            </span>
            {w.status === "notified" && (
              <span className="shrink-0 text-xs text-yellow-700">
                push pending
              </span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function RecentlyDeniedSection({ watches }: { watches: DeniedWatch[] }) {
  if (watches.length === 0) {
    return null;
  }
  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="mb-2 flex items-center gap-2">
        <AlertCircle className="h-4 w-4 text-muted-foreground" />
        <h3 className="font-medium text-sm">
          Recently {watches.length === 1 ? "skipped" : "skipped or errored"}
        </h3>
      </div>
      <ul className="space-y-1 text-sm text-muted-foreground">
        {watches.map((w) => (
          <li key={w.id}>
            {w.productName}
            <span className="text-xs"> ({w.status})</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function WatchlistDisplay({ result }: { result: WatchlistResult }) {
  const { active, unacknowledgedPurchases, recentlyDenied } = result;
  const empty =
    active.length === 0 &&
    unacknowledgedPurchases.length === 0 &&
    recentlyDenied.length === 0;

  if (empty) {
    return (
      <div className="rounded-lg border bg-card p-4 text-muted-foreground text-sm">
        Your watchlist is empty.
      </div>
    );
  }

  return (
    <div>
      {unacknowledgedPurchases.map((order) => (
        <OrderConfirmationCard key={order.watchId} order={order} />
      ))}
      <ActiveWatchesSection watches={active} />
      <RecentlyDeniedSection watches={recentlyDenied} />
    </div>
  );
}
