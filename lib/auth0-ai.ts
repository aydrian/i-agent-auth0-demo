import { Auth0AI } from "@auth0/ai-vercel";
import { getRefreshToken } from "./auth0";
import { setWatchNotified } from "./db/queries/watchlist";

const auth0AI = new Auth0AI();

export const withGmailRead = auth0AI.withTokenVault({
  connection: "google-oauth2",
  scopes: ["https://www.googleapis.com/auth/gmail.readonly"],
  refreshToken: getRefreshToken,
});

/**
 * Build a CIBA wrapper for a specific watchlist row + observed price.
 *
 * The wrapper is constructed per-watch because:
 *  - We don't have a chat session in cron, so `userID` can't read it from
 *    `auth0.getSession()`. We close over the watch row's userId instead.
 *  - We want `setWatchNotified` to fire the moment the push goes out
 *    (before the user has approved). That's `onAuthorizationRequest`.
 *
 * Behavior in cron context: `await creds` inside `onAuthorizationRequest`
 * blocks until the SDK's internal polling resolves (or rejects on
 * denied/expired). The chat route's `setAIContext` is what would flip
 * this to interrupt mode — the cron doesn't call it, so we get blocking.
 */
export const withShopBuyApproval = (params: {
  watchId: string;
  userId: string;
  currentPrice: number;
}) =>
  auth0AI.withAsyncAuthorization({
    userID: async () => params.userId,
    bindingMessage: async ({ bindingMessage }: { bindingMessage: string }) =>
      bindingMessage,
    scopes: ["openid", "product:buy"],
    audience: requireEnv("SHOP_API_AUDIENCE"),
    onAuthorizationRequest: async (_authReq, creds) => {
      await setWatchNotified(params.watchId, params.currentPrice);
      await creds;
    },
  });

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return v;
}
