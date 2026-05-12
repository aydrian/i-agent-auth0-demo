"use client";

import { useState } from "react";
import {
  type ConnectedAccount,
  fetchConnectedAccounts,
} from "@/lib/actions/profile";
import type { AppUser } from "@/lib/auth0-types";
import { ConnectedAccountsCard } from "./connected-accounts-card";
import { UserInfoCard } from "./user-info-card";

export function ProfileContent({
  user,
  initialAccounts,
}: {
  user: AppUser;
  initialAccounts: ConnectedAccount[];
}) {
  const [connectedAccounts, setConnectedAccounts] =
    useState<ConnectedAccount[]>(initialAccounts);
  const [loading, setLoading] = useState(false);

  const loadConnectedAccounts = async () => {
    setLoading(true);
    try {
      const accounts = await fetchConnectedAccounts();
      setConnectedAccounts(accounts);
    } catch (error) {
      console.error("Error fetching connected accounts:", error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
      <UserInfoCard user={user} />
      <ConnectedAccountsCard
        connectedAccounts={connectedAccounts}
        loading={loading}
        onAccountDeleted={loadConnectedAccounts}
      />
    </div>
  );
}
