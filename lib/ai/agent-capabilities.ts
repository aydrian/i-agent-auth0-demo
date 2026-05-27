export type CapabilityAuth =
  | { kind: "always" }
  | { kind: "token-vault"; connection: string; scopes: string[] };

export type Capability = {
  id: string;
  displayName: string;
  description: string;
  auth: CapabilityAuth;
  status: "registered" | "planned";
};

const GOOGLE_OAUTH = "google-oauth2";

export const AGENT_CAPABILITIES: readonly Capability[] = [
  {
    id: "getWeather",
    displayName: "Look up the weather",
    description:
      "Fetch the current weather for a city or coordinates the user mentions.",
    auth: { kind: "always" },
    status: "registered",
  },
  {
    id: "documentArtifacts",
    displayName: "Create and edit documents, code, and spreadsheets",
    description:
      "Open a side artifact panel for long-form writing, code, or CSV data and iterate on it together with the user.",
    auth: { kind: "always" },
    status: "registered",
  },
  {
    id: "gmailSearch",
    displayName: "Search the user's Gmail inbox",
    description:
      "Translate natural-language questions into Gmail search queries and return matching messages.",
    auth: {
      kind: "token-vault",
      connection: GOOGLE_OAUTH,
      scopes: ["https://www.googleapis.com/auth/gmail.readonly"],
    },
    status: "registered",
  },
  {
    id: "gmailCompose",
    displayName: "Draft and send Gmail messages",
    description:
      "Compose, draft, or send email on the user's behalf from their Gmail account.",
    auth: {
      kind: "token-vault",
      connection: GOOGLE_OAUTH,
      scopes: ["https://www.googleapis.com/auth/gmail.compose"],
    },
    status: "planned",
  },
  {
    id: "calendarEvents",
    displayName: "Read and create Google Calendar events",
    description:
      "Look up the user's calendar, find free time, and schedule events.",
    auth: {
      kind: "token-vault",
      connection: GOOGLE_OAUTH,
      scopes: ["https://www.googleapis.com/auth/calendar.events"],
    },
    status: "planned",
  },
  {
    id: "googleTasks",
    displayName: "Manage Google Tasks",
    description:
      "Read, create, and complete tasks in the user's Google Tasks lists.",
    auth: {
      kind: "token-vault",
      connection: GOOGLE_OAUTH,
      scopes: ["https://www.googleapis.com/auth/tasks"],
    },
    status: "planned",
  },
];
