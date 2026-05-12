"use client";

import { usePathname } from "next/navigation";
import { ChatShell } from "./shell";

export function ChatShellGate() {
  const pathname = usePathname();
  if (pathname?.startsWith("/profile")) {
    return null;
  }
  return <ChatShell />;
}
