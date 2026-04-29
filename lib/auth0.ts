import { Auth0Client } from "@auth0/nextjs-auth0/server";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

export const auth0 = new Auth0Client({
  domain: requireEnv("AUTH0_DOMAIN"),
  clientId: requireEnv("AUTH0_CLIENT_ID"),
  clientSecret: requireEnv("AUTH0_CLIENT_SECRET"),
  secret: requireEnv("AUTH0_SECRET"),
  appBaseUrl: requireEnv("APP_BASE_URL"),
});
