"use client";

import { format } from "date-fns";
import { ExternalLink, Loader2, Trash2, UserPlus } from "lucide-react";
import { useState } from "react";
import {
  type ConnectedAccount,
  deleteConnectedAccount,
} from "@/lib/actions/profile";

const SCOPE_LABELS: Record<string, string> = {
  "https://www.googleapis.com/auth/gmail.readonly": "Gmail (read)",
  "https://www.googleapis.com/auth/gmail.compose": "Gmail (compose)",
  "https://www.googleapis.com/auth/calendar.events": "Calendar (events)",
  "https://www.googleapis.com/auth/tasks": "Tasks",
  openid: "OpenID",
};

function formatScope(scope: string): string {
  if (SCOPE_LABELS[scope]) {
    return SCOPE_LABELS[scope];
  }
  try {
    const url = new URL(scope);
    return url.pathname.replace(/^\/auth\//, "").replace(/^\//, "") || scope;
  } catch {
    return scope;
  }
}

interface ConnectedAccountsCardProps {
  connectedAccounts: ConnectedAccount[];
  loading: boolean;
  onAccountDeleted?: () => void;
}

export function ConnectedAccountsCard({
  connectedAccounts,
  loading,
  onAccountDeleted,
}: ConnectedAccountsCardProps) {
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const handleDelete = async (accountId: string) => {
    if (
      // biome-ignore lint/suspicious/noAlert: baseline UX matches reference app
      !confirm("Are you sure you want to delete this connected account?")
    ) {
      return;
    }

    setDeletingId(accountId);
    try {
      const result = await deleteConnectedAccount(accountId);
      if (result.success) {
        onAccountDeleted?.();
      } else {
        // biome-ignore lint/suspicious/noAlert: baseline UX matches reference app
        alert(`Failed to delete account: ${result.error}`);
      }
    } catch {
      // biome-ignore lint/suspicious/noAlert: baseline UX matches reference app
      alert("An error occurred while deleting the account");
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="rounded-lg border bg-card p-6">
      <div className="mb-6 flex items-center justify-between">
        <h2 className="text-xl font-semibold text-foreground">
          Token Vault Connections
        </h2>
        <span className="text-sm text-muted-foreground">
          {connectedAccounts.length} connected
        </span>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <div className="space-y-4">
          {connectedAccounts.length > 0 ? (
            <div className="space-y-3">
              {connectedAccounts.map((account) => (
                <div
                  className="rounded-lg border bg-muted/40 p-3"
                  key={account.id}
                >
                  <div className="flex-1">
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-medium text-foreground">
                        {account.connection}
                      </p>
                      <button
                        className="ml-4 rounded-lg p-2 text-destructive transition-colors hover:bg-destructive/10 disabled:cursor-not-allowed disabled:opacity-50"
                        disabled={deletingId === account.id}
                        onClick={() => handleDelete(account.id)}
                        title="Delete connected account"
                        type="button"
                      >
                        {deletingId === account.id ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Trash2 className="h-4 w-4" />
                        )}
                      </button>
                    </div>
                    <div className="mb-2 flex items-center justify-between">
                      <div className="flex gap-4 text-xs text-muted-foreground">
                        {account.created_at && (
                          <span>
                            Created:{" "}
                            {format(
                              new Date(account.created_at),
                              "dd-MMM-yy HH:mm"
                            )}
                          </span>
                        )}
                        {account.expires_at && (
                          <span>
                            Expires:{" "}
                            {format(
                              new Date(account.expires_at),
                              "dd-MMM-yy HH:mm"
                            )}
                          </span>
                        )}
                      </div>
                    </div>
                    {account.scopes && account.scopes.length > 0 && (
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-muted-foreground">
                          Scopes:
                        </span>
                        <div className="flex flex-wrap gap-1.5">
                          {account.scopes.map((scope) => (
                            <span
                              className="max-w-[15.625rem] truncate rounded border bg-muted px-2 py-0.5 text-xs text-foreground"
                              key={scope}
                              title={scope}
                            >
                              {formatScope(scope)}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="py-8 text-center">
              <UserPlus className="mx-auto mb-3 h-12 w-12 text-muted-foreground/60" />
              <p className="text-muted-foreground">
                No Token Vault connections
              </p>
            </div>
          )}

          <div className="mt-6 rounded-lg border bg-accent p-4 text-accent-foreground">
            <div className="flex items-start gap-3">
              <ExternalLink className="mt-0.5 h-5 w-5 shrink-0" />
              <div className="text-sm">
                <p className="mb-1 font-medium">
                  <a
                    className="underline-offset-2 hover:underline"
                    href="https://auth0.com/ai/docs/intro/token-vault#what-is-connected-accounts-for-token-vault"
                    rel="noopener noreferrer"
                    target="_blank"
                  >
                    Token Vault
                  </a>
                </p>
                <p className="text-xs leading-relaxed text-accent-foreground/80">
                  Token Vault stores OAuth tokens for third-party APIs. These
                  connections power the assistant&apos;s tools (Gmail, Calendar,
                  Tasks, etc.) and can be revoked at any time.
                </p>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
