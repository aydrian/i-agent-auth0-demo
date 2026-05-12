"use server";

import { auth0 } from "@/lib/auth0";

export interface ConnectedAccount {
  id: string;
  connection: string;
  access_type: string;
  scopes: string[];
  created_at: Date;
  expires_at: Date;
}

const CONNECTED_ACCOUNTS_AUDIENCE = `https://${process.env.AUTH0_DOMAIN}/me/`;
const CONNECTED_ACCOUNTS_BASE_URL = `https://${process.env.AUTH0_DOMAIN}/me/v1/connected-accounts/accounts`;

async function getConnectedAccountsToken(
  scope: string
): Promise<string | null> {
  const { token } = await auth0.getAccessToken({
    audience: CONNECTED_ACCOUNTS_AUDIENCE,
    scope,
  });
  return token || null;
}

export async function fetchConnectedAccounts(): Promise<ConnectedAccount[]> {
  const token = await getConnectedAccountsToken("read:me:connected_accounts");
  if (!token) {
    return [];
  }

  const response = await fetch(CONNECTED_ACCOUNTS_BASE_URL, {
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
  });

  if (!response.ok) {
    return [];
  }

  const data = await response.json();
  return data.accounts || [];
}

export async function deleteConnectedAccount(
  connectedAccountId: string
): Promise<{ success: boolean; error?: string }> {
  const token = await getConnectedAccountsToken("delete:me:connected_accounts");
  if (!token) {
    return { success: false, error: "No token retrieved" };
  }

  const response = await fetch(
    `${CONNECTED_ACCOUNTS_BASE_URL}/${connectedAccountId}`,
    {
      method: "DELETE",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
    }
  );

  if (!response.ok) {
    return { success: false, error: await response.text() };
  }

  return { success: true };
}
