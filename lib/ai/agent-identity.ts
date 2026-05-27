import {
  type ConnectedAccount,
  fetchConnectedAccounts,
} from "@/lib/actions/profile";
import type { AppSession } from "@/lib/auth0-types";
import {
  AGENT_CAPABILITIES,
  type Capability,
  type CapabilityAuth,
} from "./agent-capabilities";

export type AgentIdentity = {
  userName: string;
  available: Capability[];
  needsAuthorization: Capability[];
  planned: Capability[];
};

function resolveUserName(session: AppSession): string {
  const user = session.user;
  if (user.name) {
    return user.name;
  }
  if (user.nickname) {
    return user.nickname;
  }
  if (user.email) {
    const [local] = user.email.split("@");
    if (local) {
      return local;
    }
  }
  return "there";
}

function hasRequiredScopes(
  accounts: ConnectedAccount[],
  auth: Extract<CapabilityAuth, { kind: "token-vault" }>
): boolean {
  return accounts.some((account) => {
    if (account.connection !== auth.connection) {
      return false;
    }
    const granted = new Set(account.scopes);
    return auth.scopes.every((scope) => granted.has(scope));
  });
}

export async function buildAgentIdentity({
  session,
}: {
  session: AppSession;
}): Promise<AgentIdentity> {
  const userName = resolveUserName(session);
  const accounts = await fetchConnectedAccounts();

  const available: Capability[] = [];
  const needsAuthorization: Capability[] = [];
  const planned: Capability[] = [];

  for (const capability of AGENT_CAPABILITIES) {
    if (capability.status === "planned") {
      planned.push(capability);
      continue;
    }
    if (capability.auth.kind === "always") {
      available.push(capability);
      continue;
    }
    if (hasRequiredScopes(accounts, capability.auth)) {
      available.push(capability);
    } else {
      needsAuthorization.push(capability);
    }
  }

  return { userName, available, needsAuthorization, planned };
}
