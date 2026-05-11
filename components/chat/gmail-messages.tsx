"use client";

import { Mail } from "lucide-react";
import type { GmailSearchOutput } from "@/lib/ai/tools/gmail-search";

export function GmailMessages({ result }: { result: GmailSearchOutput }) {
  const { query, messagesCount, messages } = result;

  return (
    <div className="rounded-xl border border-border/40 bg-gradient-to-br from-background to-muted/40 p-4 shadow-[var(--shadow-card)]">
      <div className="flex items-center gap-2">
        <Mail className="size-4 text-muted-foreground" />
        <h3 className="font-semibold text-sm">Emails ({messagesCount})</h3>
      </div>

      {query && (
        <p className="mt-1 text-muted-foreground text-xs">
          Search: <span className="font-mono">&ldquo;{query}&rdquo;</span>
        </p>
      )}

      {messages.length === 0 ? (
        <p className="py-3 text-muted-foreground text-sm">No emails found.</p>
      ) : (
        <ul className="mt-3 divide-y divide-border/40">
          {messages.map((m) => (
            <li className="py-2.5 first:pt-1 last:pb-1" key={m.id}>
              {m.sender && (
                <p className="truncate font-medium text-sm">{m.sender}</p>
              )}
              {m.subject && (
                <p className="mt-0.5 truncate text-sm">{m.subject}</p>
              )}
              {m.snippet && (
                <p className="mt-1 line-clamp-2 text-muted-foreground text-xs">
                  {m.snippet}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
