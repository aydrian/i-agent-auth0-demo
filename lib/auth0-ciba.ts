import "server-only";

export type CibaApprovalErrorReason =
  | "access_denied"
  | "expired_token"
  | "slow_down"
  | "transaction_failed"
  | "timeout"
  | "configuration"
  | "network";

export class CibaApprovalError extends Error {
  reason: CibaApprovalErrorReason;

  constructor(
    reason: CibaApprovalErrorReason,
    message: string,
    cause?: unknown
  ) {
    super(message);
    this.name = "CibaApprovalError";
    this.reason = reason;
    if (cause !== undefined) {
      this.cause = cause;
    }
  }
}

type AuthorizeResponse = {
  auth_req_id: string;
  expires_in: number;
  interval?: number;
};

type TokenSuccess = {
  access_token: string;
  token_type: string;
  expires_in: number;
  scope?: string;
};

type TokenError = {
  error:
    | "authorization_pending"
    | "slow_down"
    | "expired_token"
    | "access_denied"
    | "invalid_request"
    | "invalid_grant"
    | "unauthorized_client";
  error_description?: string;
};

export type RequestCibaApprovalArgs = {
  userId: string;
  bindingMessage: string;
  scopes: string[];
  audience: string;
  timeoutMs?: number;
};

export async function requestCibaApproval({
  userId,
  bindingMessage,
  scopes,
  audience,
  timeoutMs = 90_000,
}: RequestCibaApprovalArgs): Promise<{ accessToken: string }> {
  const domain = requireEnv("AUTH0_DOMAIN");
  const clientId = requireEnv("AUTH0_CLIENT_ID");
  const clientSecret = requireEnv("AUTH0_CLIENT_SECRET");

  const baseUrl = domain.startsWith("http")
    ? domain.replace(/\/$/, "")
    : `https://${domain}`;
  const authorizeUrl = `${baseUrl}/bc-authorize`;
  const tokenUrl = `${baseUrl}/oauth/token`;
  const issuer = `${baseUrl}/`;

  const loginHint = JSON.stringify({
    format: "iss_sub",
    iss: issuer,
    sub: userId,
  });

  const authorizeBody = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    scope: scopes.join(" "),
    audience,
    binding_message: bindingMessage,
    login_hint: loginHint,
  });

  let authorize: AuthorizeResponse;
  try {
    const res = await fetch(authorizeUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: authorizeBody.toString(),
      cache: "no-store",
    });
    if (!res.ok) {
      throw new CibaApprovalError(
        "configuration",
        `bc-authorize ${res.status}: ${await res.text()}`
      );
    }
    authorize = (await res.json()) as AuthorizeResponse;
    console.log("[ciba] /bc-authorize OK", {
      auth_req_id: authorize.auth_req_id,
      expires_in: authorize.expires_in,
      interval: authorize.interval,
      bindingMessageLength: bindingMessage.length,
    });
  } catch (err) {
    if (err instanceof CibaApprovalError) {
      throw err;
    }
    throw new CibaApprovalError("network", "bc-authorize failed", err);
  }

  const start = Date.now();
  let intervalSec = Math.max(1, authorize.interval ?? 5);

  while (Date.now() - start < timeoutMs) {
    await sleep(intervalSec * 1000);
    const tokenBody = new URLSearchParams({
      grant_type: "urn:openid:params:grant-type:ciba",
      auth_req_id: authorize.auth_req_id,
      client_id: clientId,
      client_secret: clientSecret,
    });

    let res: Response;
    try {
      res = await fetch(tokenUrl, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: tokenBody.toString(),
        cache: "no-store",
      });
    } catch (err) {
      throw new CibaApprovalError("network", "/oauth/token failed", err);
    }

    if (res.ok) {
      const success = (await res.json()) as TokenSuccess;
      return { accessToken: success.access_token };
    }

    let payload: TokenError;
    try {
      payload = (await res.json()) as TokenError;
    } catch {
      throw new CibaApprovalError(
        "transaction_failed",
        `Unexpected token response ${res.status}`
      );
    }

    switch (payload.error) {
      case "authorization_pending":
        continue;
      case "slow_down":
        intervalSec += 5;
        continue;
      case "expired_token":
        throw new CibaApprovalError(
          "expired_token",
          payload.error_description ?? "Push expired"
        );
      case "access_denied":
        throw new CibaApprovalError(
          "access_denied",
          payload.error_description ?? "User denied"
        );
      default:
        throw new CibaApprovalError(
          "transaction_failed",
          `${payload.error}: ${payload.error_description ?? ""}`
        );
    }
  }

  throw new CibaApprovalError("timeout", "CIBA approval timed out");
}

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) {
    throw new CibaApprovalError("configuration", `Missing ${name}`);
  }
  return v;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
