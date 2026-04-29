import type { SessionData, User } from "@auth0/nextjs-auth0/types";

/**
 * Application session type, aliased from the Auth0 SDK's SessionData.
 * Use this everywhere the app passes a session around (e.g. AI tools).
 */
export type AppSession = SessionData;

/**
 * Auth0 user profile, keyed by `sub`.
 */
export type AppUser = User;
