import { tool } from "ai";
import { z } from "zod";
import { deleteWatch } from "@/lib/db/queries/watchlist";

export const watchlistRemove = ({ userId }: { userId: string }) =>
  tool({
    description:
      "Remove a watchlist entry by its id. Use after calling watchlistList to find the id when the user asks to stop watching a product.",
    inputSchema: z.object({
      watchId: z
        .string()
        .min(1)
        .describe("The watch entry id (uuid) returned by watchlistList."),
    }),
    execute: async ({ watchId }) => {
      const removed = await deleteWatch({ id: watchId, userId });
      return { watchId, removed };
    },
  });
