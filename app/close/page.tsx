"use client";

import { useEffect } from "react";

export default function ClosePage() {
  useEffect(() => {
    window.close();
  }, []);

  return (
    <div className="flex min-h-screen items-center justify-center p-6 text-center text-sm text-muted-foreground">
      You can close this window.
    </div>
  );
}
