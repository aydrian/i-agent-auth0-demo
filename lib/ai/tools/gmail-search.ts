import { TokenVaultInterrupt } from "@auth0/ai/interrupts";
import { getAccessTokenFromTokenVault } from "@auth0/ai-vercel";
import { tool } from "ai";
import { google } from "googleapis";
import { z } from "zod";
import { withGmailRead } from "@/lib/auth0-ai";

function isUnauthorized(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }
  const status = (error as { status?: unknown }).status;
  const code = (error as { code?: unknown }).code;
  const responseStatus = (error as { response?: { status?: unknown } }).response
    ?.status;
  return status === 401 || code === 401 || responseStatus === 401;
}

const GMAIL_READ_CONNECTION = "google-oauth2";
const GMAIL_READ_SCOPES = ["https://www.googleapis.com/auth/gmail.readonly"];

function getHeader(
  headers: Array<{ name?: string | null; value?: string | null }> | undefined,
  name: string
): string | undefined {
  return (
    headers?.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value ??
    undefined
  );
}

export const gmailSearch = withGmailRead(
  tool({
    description:
      "Search the user's Gmail inbox. Use this whenever the user asks about their email, inbox, messages, senders, subjects, or anything that might live in their email. Translate the user's natural-language question into Gmail search operators (for example: 'from:alice', 'subject:invoice', 'is:unread', 'newer_than:7d'). Returns matching messages with sender, subject, date, and a short snippet.",
    inputSchema: z.object({
      query: z
        .string()
        .describe(
          "Gmail search query using Gmail operators (e.g., 'from:stripe subject:invoice')."
        ),
      maxResults: z
        .number()
        .int()
        .min(1)
        .max(25)
        .optional()
        .describe("Maximum number of messages to return. Default 10, max 25."),
    }),
    execute: async ({ query, maxResults = 10 }) => {
      const accessToken = await getAccessTokenFromTokenVault();

      try {
        const auth = new google.auth.OAuth2();
        auth.setCredentials({ access_token: accessToken });
        const gmail = google.gmail({ version: "v1", auth });

        const { data } = await gmail.users.messages.list({
          userId: "me",
          q: query,
          maxResults,
        });

        const refs = data.messages ?? [];
        if (refs.length === 0) {
          return { query, messagesCount: 0, messages: [] as GmailMessage[] };
        }

        const messages: GmailMessage[] = await Promise.all(
          refs.map(async (ref) => {
            const { data: msg } = await gmail.users.messages.get({
              userId: "me",
              id: ref.id ?? "",
              format: "metadata",
              metadataHeaders: ["Subject", "From", "Date"],
            });
            const headers = msg.payload?.headers ?? undefined;
            return {
              id: ref.id ?? "",
              threadId: ref.threadId ?? "",
              snippet: msg.snippet ?? "",
              subject: getHeader(headers, "Subject"),
              sender: getHeader(headers, "From"),
              date: getHeader(headers, "Date"),
            };
          })
        );

        return { query, messagesCount: messages.length, messages };
      } catch (error) {
        if (isUnauthorized(error)) {
          throw new TokenVaultInterrupt(
            "Authorization required to read Gmail.",
            {
              connection: GMAIL_READ_CONNECTION,
              scopes: GMAIL_READ_SCOPES,
              requiredScopes: GMAIL_READ_SCOPES,
            }
          );
        }
        throw error;
      }
    },
  })
);

export type GmailMessage = {
  id: string;
  threadId: string;
  snippet: string;
  subject?: string;
  sender?: string;
  date?: string;
};

export type GmailSearchOutput = {
  query: string;
  messagesCount: number;
  messages: GmailMessage[];
};
