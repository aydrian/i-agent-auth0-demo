/**
 * scripts/demos/seed-gmail.ts
 *
 * Operator-side scaffolding for the Camp AI NY demo. Drops a small set of
 * plausible investor-flavored emails into the demo Gmail inbox so the Token
 * Vault beat (`gmailSearch` for "any unread emails from investors this
 * month?") returns realistic-looking results.
 *
 * Uses a *separate* OAuth grant from the user's Auth0 Token Vault grant.
 * The Token Vault grant stays pinned at `gmail.readonly`; this seeder uses
 * an operator-owned refresh token with `gmail.insert` + `gmail.modify`
 * scopes, configured once via the Google OAuth Playground (see
 * docs/demos/camp-ai-ny.md). The two grants live in different OAuth clients
 * and never cross.
 *
 * Subcommands:
 *   seed   Insert the canned messages. Each subject contains
 *          `[demo:camp-ai-ny]` so they can be located later.
 *   clear  Find every message with `[demo:camp-ai-ny]` in the subject
 *          (in any label, including Trash) and trash it. Idempotent.
 *
 * Env vars (loaded from .env.local):
 *   SEED_GMAIL_REFRESH_TOKEN    refresh token for the demo Gmail account
 *   SEED_GMAIL_CLIENT_ID        OAuth client id used to mint the token
 *   SEED_GMAIL_CLIENT_SECRET    OAuth client secret matching the client id
 */

import { config } from "dotenv";
import { google } from "googleapis";

config({ path: ".env.local" });

const SUBJECT_MARKER = "[demo:camp-ai-ny]";

type CannedMessage = {
  from: string;
  subject: string;
  body: string;
  /** Hours ago — used to set a plausible Date header. */
  ageHours: number;
};

const CANNED_MESSAGES: CannedMessage[] = [
  {
    from: "Marc Whitley <marc@northstar-ventures.demo>",
    subject: `Following up — series A discussion? ${SUBJECT_MARKER}`,
    ageHours: 6,
    body: [
      "Great chatting at Camp AI last night. Loved the agent demo — the CIBA",
      "approval flow on stage was a nice touch.",
      "",
      "Could we grab 30 minutes early next week to dig into the round? I'd",
      "like to bring our infra partner along.",
      "",
      "Marc",
      "Northstar Ventures",
    ].join("\n"),
  },
  {
    from: "Priya Shah <priya@halflight.fund>",
    subject: `Term sheet draft for review ${SUBJECT_MARKER}`,
    ageHours: 26,
    body: [
      "Hi —",
      "",
      "Putting the draft term sheet in front of you tonight. Two open items I",
      "wanted to flag before you read it:",
      "",
      "  1. Board composition (we'd like one independent seat at series A).",
      "  2. Pro-rata language on the SAFE conversion.",
      "",
      "Happy to jump on a call tomorrow if it's easier than email.",
      "",
      "Priya",
      "Halflight",
    ].join("\n"),
  },
  {
    from: "Daniel Cao <daniel@latebreaker.partners>",
    subject: `Loved the demo — coffee this week? ${SUBJECT_MARKER}`,
    ageHours: 50,
    body: [
      "Saw you on stage at Camp AI. The Auth0 + agent identity story is",
      "exactly the kind of platform layer we've been looking at.",
      "",
      "Free for coffee this week? I'm in the city through Friday.",
      "",
      "Daniel",
    ].join("\n"),
  },
  {
    from: "Camp AI Intros <intros@camp-ai.demo>",
    subject: `Quick intro: Sarah at Anthropic platform ${SUBJECT_MARKER}`,
    ageHours: 96,
    body: [
      "Looping you in — Sarah leads platform tooling on the Anthropic side and",
      "is actively talking to founders shipping agent products. I think you",
      "two should connect.",
      "",
      "Sarah, meet $founder. $founder, meet Sarah.",
      "",
      "I'll let you take it from here.",
    ].join("\n"),
  },
  {
    from: "Calendly <noreply@calendly.com>",
    subject: `New booking: Investor sync (Tue 10:00 AM) ${SUBJECT_MARKER}`,
    ageHours: 14,
    body: [
      "A new event has been scheduled.",
      "",
      "  Event:    Investor sync",
      "  Invitee:  Marc Whitley (marc@northstar-ventures.demo)",
      "  When:     Tuesday, 10:00 AM – 10:30 AM",
      "  Where:    Google Meet (link in calendar invite)",
      "",
      "View on Calendly: https://calendly.com/demo/investor-sync",
    ].join("\n"),
  },
];

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(
      `error: ${name} is not set. Add it to .env.local. See docs/demos/camp-ai-ny.md for setup.`
    );
    process.exit(1);
  }
  return value;
}

function buildAuth() {
  const clientId = requireEnv("SEED_GMAIL_CLIENT_ID");
  const clientSecret = requireEnv("SEED_GMAIL_CLIENT_SECRET");
  const refreshToken = requireEnv("SEED_GMAIL_REFRESH_TOKEN");

  const auth = new google.auth.OAuth2(clientId, clientSecret);
  auth.setCredentials({ refresh_token: refreshToken });
  return auth;
}

function base64UrlEncode(input: string): string {
  return Buffer.from(input, "utf-8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function buildRfc822(msg: CannedMessage): string {
  const date = new Date(Date.now() - msg.ageHours * 60 * 60 * 1000);
  const headers = [
    `From: ${msg.from}`,
    "To: me",
    `Subject: ${msg.subject}`,
    `Date: ${date.toUTCString()}`,
    "MIME-Version: 1.0",
    `Content-Type: text/plain; charset="UTF-8"`,
    "Content-Transfer-Encoding: 7bit",
  ];
  return `${headers.join("\r\n")}\r\n\r\n${msg.body}\r\n`;
}

async function seed(): Promise<void> {
  const gmail = google.gmail({ version: "v1", auth: buildAuth() });

  let inserted = 0;
  for (const msg of CANNED_MESSAGES) {
    const raw = base64UrlEncode(buildRfc822(msg));
    await gmail.users.messages.insert({
      userId: "me",
      internalDateSource: "dateHeader",
      requestBody: {
        raw,
        labelIds: ["INBOX", "UNREAD"],
      },
    });
    inserted += 1;
    console.log(`  inserted: ${msg.subject}`);
  }
  console.log(`\n✓ Inserted ${inserted} message(s) into the demo inbox.`);
}

async function clear(): Promise<void> {
  const gmail = google.gmail({ version: "v1", auth: buildAuth() });

  const query = `subject:"${SUBJECT_MARKER}"`;
  let trashed = 0;
  let pageToken: string | undefined;

  do {
    const { data } = await gmail.users.messages.list({
      userId: "me",
      q: query,
      includeSpamTrash: true,
      pageToken,
      maxResults: 100,
    });

    const ids = (data.messages ?? [])
      .map((m) => m.id)
      .filter((id): id is string => Boolean(id));

    for (const id of ids) {
      await gmail.users.messages.trash({ userId: "me", id });
      trashed += 1;
    }

    pageToken = data.nextPageToken ?? undefined;
  } while (pageToken);

  if (trashed === 0) {
    console.log("✓ No demo messages found. Inbox already clean.");
  } else {
    console.log(`✓ Trashed ${trashed} demo message(s).`);
  }
}

async function main(): Promise<void> {
  const subcommand = process.argv[2];
  switch (subcommand) {
    case "seed":
      await seed();
      break;
    case "clear":
      await clear();
      break;
    default:
      console.error("Usage: pnpm tsx scripts/demos/seed-gmail.ts <seed|clear>");
      process.exit(1);
  }
}

main().catch((err) => {
  console.error("seed-gmail failed:");
  console.error(err);
  process.exit(2);
});
