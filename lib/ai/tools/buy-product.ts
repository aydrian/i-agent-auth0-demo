import { tool } from "ai";
import { z } from "zod";
import {
  CibaApprovalError,
  requestCibaApproval,
} from "@/lib/auth0-ciba";
import {
  setWatchNotified,
  setWatchPurchased,
} from "@/lib/db/queries/watchlist";
import { placeOrderWithToken } from "@/lib/shop-api-client";

export type BuyProductParams = {
  watchId: string;
  userId: string;
  productId: string;
  currentPrice: number;
};

// Auth0's CIBA binding_message has two restrictions we discovered the hard way:
//   1. Max 64 characters.
//   2. Only alphanumerics, whitespace, and the characters `+`, `-`, `_`, `.`,
//      `,`, `:`, `#`. Common punctuation like `$`, `?`, `(`, `)`, `'`, `"`,
//      `/` is rejected with HTTP 400.
// We sanitize defensively so a too-eager LLM can't break the flow.
const ALLOWED_BINDING_MESSAGE_RE = /[^A-Za-z0-9\s+\-_.,:#]/g;

function sanitizeBindingMessage(input: string): string {
  return input
    .replace(ALLOWED_BINDING_MESSAGE_RE, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 64);
}

/**
 * In-cron purchase tool. Fires CIBA directly via `requestCibaApproval`.
 *
 * Returns a structured `{ ok: boolean, ... }` result instead of throwing on
 * CIBA failure. The AI SDK turns a thrown `execute` into a tool-error step
 * the model retries against; that's correct for transient errors but wrong
 * for our flow (denied / configuration errors should propagate to the cron
 * unambiguously, not get retried into a phantom success). The structured
 * return lets the cron's success-detection look at `result.output.ok` and
 * map outcomes correctly.
 */
export const buyProduct = (params: BuyProductParams) =>
  tool({
    description:
      "Send the user a one-tap approval request for this purchase. Returns { ok, orderId } on approval; { ok: false, error } if the user declined or the request expired. The bindingMessage is the single sentence the user sees while deciding — keep it concise and use only letters, numbers, whitespace, and the characters + - _ . , : # (no $, ?, parens, quotes; Auth0 rejects them). The tool handles authentication and order placement internally; you do not need any credentials of your own.",
    inputSchema: z.object({
      bindingMessage: z
        .string()
        .min(1)
        .max(64)
        .describe(
          "MAX 64 chars. Allowed characters: a-z, A-Z, 0-9, whitespace, and + - _ . , : # (NO $, ?, parens, quotes — Auth0 rejects them)."
        ),
      qty: z.number().int().positive().default(1),
    }),
    execute: async ({ bindingMessage, qty }) => {
      const safe = sanitizeBindingMessage(bindingMessage);
      if (!safe) {
        return {
          ok: false as const,
          error: "empty_binding_message",
          message:
            "bindingMessage was empty after stripping disallowed characters",
        };
      }

      await setWatchNotified(params.watchId, params.currentPrice);

      try {
        const approved = await requestCibaApproval({
          userId: params.userId,
          bindingMessage: safe,
          scopes: ["openid", "product:buy"],
          audience: requireEnv("SHOP_API_AUDIENCE"),
        });

        const order = await placeOrderWithToken(
          params.productId,
          qty,
          approved.accessToken
        );
        await setWatchPurchased({
          id: params.watchId,
          orderId: order.orderId,
          purchasedPrice: params.currentPrice,
          purchaseDetails: order,
        });
        return { ok: true as const, orderId: order.orderId };
      } catch (err) {
        if (err instanceof CibaApprovalError) {
          return {
            ok: false as const,
            error: err.reason,
            message: err.message,
          };
        }
        // Unexpected — let it propagate so the cron logs it as an error.
        throw err;
      }
    },
  });

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return v;
}
