import "server-only";

import { and, eq, inArray, isNull, lt, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { ChatbotError } from "@/lib/errors";
import { type Watchlist, watchlist } from "../schema";

const client = postgres(process.env.POSTGRES_URL ?? "");
const db = drizzle(client);

export type WatchlistStatus = Watchlist["status"];

export async function createWatch(input: {
  userId: string;
  productId: string;
  productName: string;
  intent: string;
}): Promise<Watchlist> {
  try {
    const [row] = await db
      .insert(watchlist)
      .values({
        userId: input.userId,
        productId: input.productId,
        productName: input.productName,
        intent: input.intent,
        status: "active",
        createdAt: new Date(),
      })
      .returning();
    return row;
  } catch (_) {
    throw new ChatbotError("bad_request:database", "Failed to create watch");
  }
}

export async function listWatchesForUser(userId: string): Promise<Watchlist[]> {
  try {
    return await db
      .select()
      .from(watchlist)
      .where(eq(watchlist.userId, userId));
  } catch (_) {
    throw new ChatbotError("bad_request:database", "Failed to list watches");
  }
}

export async function listActiveWatches(): Promise<Watchlist[]> {
  try {
    return await db
      .select()
      .from(watchlist)
      .where(eq(watchlist.status, "active"));
  } catch (_) {
    throw new ChatbotError(
      "bad_request:database",
      "Failed to list active watches"
    );
  }
}

export async function listUnacknowledgedPurchases(
  userId: string
): Promise<Watchlist[]> {
  try {
    return await db
      .select()
      .from(watchlist)
      .where(
        and(
          eq(watchlist.userId, userId),
          eq(watchlist.status, "purchased"),
          isNull(watchlist.acknowledgedAt)
        )
      );
  } catch (_) {
    throw new ChatbotError(
      "bad_request:database",
      "Failed to list unacknowledged purchases"
    );
  }
}

export async function countUnacknowledgedPurchases(
  userId: string
): Promise<number> {
  const rows = await listUnacknowledgedPurchases(userId);
  return rows.length;
}

export async function markPurchasesAcknowledged(ids: string[]): Promise<void> {
  if (ids.length === 0) {
    return;
  }
  try {
    await db
      .update(watchlist)
      .set({ acknowledgedAt: new Date() })
      .where(
        and(
          isNull(watchlist.acknowledgedAt),
          eq(watchlist.status, "purchased"),
          inArray(watchlist.id, ids)
        )
      );
  } catch (_) {
    throw new ChatbotError(
      "bad_request:database",
      "Failed to acknowledge purchases"
    );
  }
}

export async function setWatchNotified(
  id: string,
  lastSeenPrice: number
): Promise<void> {
  try {
    await db
      .update(watchlist)
      .set({
        status: "notified",
        notifiedAt: new Date(),
        lastSeenPrice: lastSeenPrice.toFixed(2),
      })
      .where(eq(watchlist.id, id));
  } catch (_) {
    throw new ChatbotError(
      "bad_request:database",
      "Failed to mark watch notified"
    );
  }
}

export async function setWatchPurchased(input: {
  id: string;
  orderId: string;
  purchasedPrice: number;
  purchaseDetails: unknown;
}): Promise<void> {
  try {
    await db
      .update(watchlist)
      .set({
        status: "purchased",
        orderId: input.orderId,
        purchasedPrice: input.purchasedPrice.toFixed(2),
        purchaseDetails: input.purchaseDetails as Record<string, unknown>,
        acknowledgedAt: null,
      })
      .where(eq(watchlist.id, input.id));
  } catch (_) {
    throw new ChatbotError(
      "bad_request:database",
      "Failed to mark watch purchased"
    );
  }
}

export async function setWatchStatus(
  id: string,
  status: Exclude<WatchlistStatus, "active" | "notified" | "purchased">
): Promise<void> {
  try {
    await db.update(watchlist).set({ status }).where(eq(watchlist.id, id));
  } catch (_) {
    throw new ChatbotError(
      "bad_request:database",
      "Failed to set watch status"
    );
  }
}

export async function resetStalledNotifiedWatches(
  olderThanMs: number
): Promise<void> {
  try {
    const cutoff = new Date(Date.now() - olderThanMs);
    await db
      .update(watchlist)
      .set({ status: "active" })
      .where(
        and(eq(watchlist.status, "notified"), lt(watchlist.notifiedAt, cutoff))
      );
  } catch (_) {
    throw new ChatbotError(
      "bad_request:database",
      "Failed to reset stalled watches"
    );
  }
}

export async function resetAgedDeniedAndErrorWatches(
  olderThanMs: number
): Promise<void> {
  try {
    const cutoff = new Date(Date.now() - olderThanMs);
    await db.execute(sql`
      UPDATE "Watchlist"
      SET status = 'active'
      WHERE status IN ('denied', 'error')
        AND "notifiedAt" IS NOT NULL
        AND "notifiedAt" < ${cutoff}
    `);
  } catch (_) {
    throw new ChatbotError(
      "bad_request:database",
      "Failed to reset aged watches"
    );
  }
}

export async function deleteWatch(input: {
  id: string;
  userId: string;
}): Promise<boolean> {
  try {
    const deleted = await db
      .delete(watchlist)
      .where(
        and(eq(watchlist.id, input.id), eq(watchlist.userId, input.userId))
      )
      .returning({ id: watchlist.id });
    return deleted.length > 0;
  } catch (_) {
    throw new ChatbotError("bad_request:database", "Failed to delete watch");
  }
}
