import { Auth0AI } from "@auth0/ai-vercel";
import { getRefreshToken } from "./auth0";

const auth0AI = new Auth0AI();

export const withGmailRead = auth0AI.withTokenVault({
  connection: "google-oauth2",
  scopes: ["openid", "https://www.googleapis.com/auth/gmail.readonly"],
  refreshToken: getRefreshToken,
});
