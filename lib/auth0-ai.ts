import { Auth0AI } from "@auth0/ai-vercel";
import { getRefreshToken } from "./auth0";
import { setWatchNotified } from "./db/queries/watchlist";

const auth0AI = new Auth0AI();

export const withGmailRead = auth0AI.withTokenVault({
  connection: "google-oauth2",
  scopes: ["https://www.googleapis.com/auth/gmail.readonly"],
  refreshToken: getRefreshToken,
});

// Auth0 CIBA's binding_message restrictions: max 64 chars, only alphanumerics +
// whitespace + `+-_.,:#`. See `docs/auth0-ciba-without-chat.md` for context.
const ALLOWED_BINDING_MESSAGE_RE = /[^A-Za-z0-9\s+\-_.,:#]/g;

export function sanitizeBindingMessage(input: string): string {
  return input
    .replace(ALLOWED_BINDING_MESSAGE_RE, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 64);
}

/**
 * SDK-wrapped CIBA approval factory. Re-introduced as an experiment to test
 * whether `@auth0/ai-vercel`'s blocking mode actually works in cron when the
 * binding_message is valid (it wasn't, in earlier tests). If this works, we
 * can drop the hand-rolled helper at `lib/auth0-ciba.ts`. If not, the
 * helper stays.
 *
 * Diagnostic logs are deliberately verbose — we want to see exactly when
 * the wrapper's hooks fire and what credentials come back.
 */
export const withShopBuyApproval = (params: {
  watchId: string;
  userId: string;
  currentPrice: number;
}) =>
  auth0AI.withAsyncAuthorization({
    userID: async () => params.userId,
    bindingMessage: async ({ bindingMessage }: { bindingMessage: string }) =>
      sanitizeBindingMessage(bindingMessage),
    scopes: ["openid", "product:buy"],
    audience: requireEnv("SHOP_API_AUDIENCE"),
    onAuthorizationRequest: async (authReq, creds) => {
      console.log("[sdk-ciba] onAuthorizationRequest fired", {
        watchId: params.watchId,
        userId: params.userId,
        authReq,
      });
      await setWatchNotified(params.watchId, params.currentPrice);
      try {
        const resolved = await creds;
        console.log("[sdk-ciba] credentials resolved", {
          watchId: params.watchId,
          hasAccessToken: typeof resolved?.accessToken === "string",
          accessTokenPrefix:
            typeof resolved?.accessToken === "string"
              ? `${resolved.accessToken.slice(0, 12)}...`
              : null,
        });
      } catch (err) {
        console.log("[sdk-ciba] credentials rejected", {
          watchId: params.watchId,
          error: (err as Error).message,
        });
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
