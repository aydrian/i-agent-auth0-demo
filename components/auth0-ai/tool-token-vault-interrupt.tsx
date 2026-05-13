"use client";

import { TokenVaultInterrupt } from "@auth0/ai/interrupts";
import type { Auth0InterruptionUI } from "@auth0/ai-vercel";
import { Loader2, LockIcon } from "lucide-react";
import { type ReactNode, useCallback, useEffect, useState } from "react";

type Props = {
  interrupt: Auth0InterruptionUI;
  label?: string;
  icon?: ReactNode;
};

export function ToolTokenVaultInterrupt({
  interrupt,
  label = "this service",
  icon,
}: Props) {
  const [popup, setPopup] = useState<Window | null>(null);
  const [isWaiting, setIsWaiting] = useState(false);

  useEffect(() => {
    if (!popup) {
      return;
    }
    const interval = setInterval(() => {
      if (popup.closed) {
        clearInterval(interval);
        setIsWaiting(false);
        setPopup(null);
        if (
          TokenVaultInterrupt.isInterrupt(interrupt) &&
          typeof interrupt.resume === "function"
        ) {
          interrupt.resume();
        }
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [popup, interrupt]);

  const startAuth = useCallback(() => {
    if (!TokenVaultInterrupt.isInterrupt(interrupt)) {
      return;
    }
    const params = new URLSearchParams({
      connection: interrupt.connection,
      returnTo: "/close",
      ...(interrupt.authorizationParams ?? {}),
    });
    for (const scope of interrupt.requiredScopes) {
      params.append("scopes", scope);
    }
    const url = new URL("/auth/connect", window.location.origin);
    url.search = params.toString();
    const features = "width=800,height=650,status=no,toolbar=no,menubar=no";
    const w = window.open(url.toString(), "_blank", features);
    if (!w) {
      console.error("Popup blocked by the browser");
      return;
    }
    setPopup(w);
    setIsWaiting(true);
  }, [interrupt]);

  if (!TokenVaultInterrupt.isInterrupt(interrupt)) {
    return null;
  }

  return (
    <div className="rounded-xl border border-border/60 bg-card p-4 shadow-[var(--shadow-card)]">
      <div className="flex items-start gap-3">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted">
          {isWaiting ? (
            <Loader2 className="size-4 animate-spin text-muted-foreground" />
          ) : (
            (icon ?? <LockIcon className="size-4 text-muted-foreground" />)
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-sm">
            {isWaiting ? "Waiting for authorization…" : "Authorization needed"}
          </p>
          <p className="mt-1 text-muted-foreground text-xs">
            {isWaiting
              ? "Complete the sign-in in the popup window to continue."
              : `Connect your account to let the assistant access ${label}.`}
          </p>
        </div>
      </div>
      <div className="mt-3 flex justify-end">
        <button
          className="rounded-md bg-primary px-3 py-1.5 text-primary-foreground text-sm transition-colors hover:bg-primary/90 disabled:opacity-50"
          disabled={isWaiting}
          onClick={startAuth}
          type="button"
        >
          {isWaiting ? "Waiting…" : "Authorize"}
        </button>
      </div>
    </div>
  );
}
