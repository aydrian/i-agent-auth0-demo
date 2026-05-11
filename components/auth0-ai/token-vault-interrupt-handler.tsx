"use client";

import { TokenVaultInterrupt } from "@auth0/ai/interrupts";
import type { Auth0InterruptionUI } from "@auth0/ai-vercel";
import { Mail } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

type Props = {
  interrupt: Auth0InterruptionUI | null | undefined;
  onFinish?: () => void;
};

export function TokenVaultInterruptHandler({ interrupt, onFinish }: Props) {
  const [popup, setPopup] = useState<Window | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!popup) {
      return;
    }
    const interval = setInterval(() => {
      if (popup.closed) {
        clearInterval(interval);
        setIsLoading(false);
        setPopup(null);
        if (onFinish) {
          onFinish();
        } else if (
          interrupt &&
          TokenVaultInterrupt.isInterrupt(interrupt) &&
          typeof interrupt.resume === "function"
        ) {
          interrupt.resume();
        }
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [popup, onFinish, interrupt]);

  const startAuth = useCallback(() => {
    if (!interrupt || !TokenVaultInterrupt.isInterrupt(interrupt)) {
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
    setIsLoading(true);
  }, [interrupt]);

  if (!interrupt || !TokenVaultInterrupt.isInterrupt(interrupt)) {
    return null;
  }

  return (
    <div className="w-[min(100%,450px)]">
      <fieldset className="flex w-full flex-col items-start justify-between gap-3 rounded-xl border border-border/60 bg-card p-4 sm:flex-row sm:items-center">
        <div className="flex items-center gap-3">
          <div className="flex size-8 items-center justify-center rounded-full bg-muted">
            <Mail className="size-4 text-muted-foreground" />
          </div>
          <div>
            <p className="font-semibold text-sm">Authorization required</p>
            <p className="text-muted-foreground text-xs">{interrupt.message}</p>
          </div>
        </div>
        <button
          className="rounded-md bg-primary px-3 py-1.5 text-primary-foreground text-sm transition-colors hover:bg-primary/90 disabled:opacity-50"
          disabled={isLoading}
          onClick={startAuth}
          type="button"
        >
          {isLoading ? "Waiting…" : "Authorize"}
        </button>
      </fieldset>
    </div>
  );
}
