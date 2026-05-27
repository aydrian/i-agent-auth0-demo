#!/usr/bin/env bash
#
# setup-auth0.sh
#
# Idempotent setup for the CIBA Price-Drop Watchlist demo's Auth0
# prerequisites. Creates the Shop API (with the `product:buy` scope) and
# adds the CIBA grant type to the configured client.
#
# Manual steps that remain after this script:
#   * Tenant Settings -> Authentication Profile -> ensure CIBA is enabled.
#   * Enroll the demo user in Guardian on a phone.
#
# Requirements:
#   * auth0 CLI (https://auth0.github.io/auth0-cli/), already logged in
#   * jq
#   * AUTH0_CLIENT_ID set (in .env.local or the environment)
#
# Env vars consumed:
#   AUTH0_CLIENT_ID       (required) the client to receive the CIBA grant
#   SHOP_API_AUDIENCE     (optional) defaults to https://api.shop-online-demo.com
#   DRY_RUN               (optional) when set to "1", print planned mutations
#                         instead of executing them
#
# Exit codes:
#   0  success
#   1  pre-flight failure (missing deps, not logged in, missing env)
#   2  unexpected runtime error
#

set -euo pipefail

# ---------------------------------------------------------------------------
# Output helpers
# ---------------------------------------------------------------------------
GREEN='\033[32m'
YELLOW='\033[33m'
RED='\033[31m'
RESET='\033[0m'

die() {
  echo -e "${RED}error:${RESET} $*" >&2
  exit "${2:-1}"
}

ok()   { echo -e "${GREEN}\xE2\x9C\x93${RESET} $*"; }
note() { echo -e "${YELLOW}\xE2\x86\x92${RESET} $*"; }
info() { echo "  $*"; }

# ---------------------------------------------------------------------------
# Cleanup / trap
# ---------------------------------------------------------------------------
TMP_FILES=""
cleanup() {
  local rc=$?
  if [ -n "$TMP_FILES" ]; then
    # shellcheck disable=SC2086
    rm -f $TMP_FILES 2>/dev/null || true
  fi
  if [ "$rc" -ne 0 ] && [ "$rc" -ne 1 ]; then
    echo -e "${RED}setup-auth0.sh exited with status $rc${RESET}" >&2
    exit 2
  fi
}
trap cleanup EXIT

# ---------------------------------------------------------------------------
# --help
# ---------------------------------------------------------------------------
usage() {
  cat <<'EOF'
Usage: scripts/setup-auth0.sh [--help]

Idempotent setup for the CIBA Price-Drop Watchlist demo's Auth0 prerequisites.

Steps performed:
  1. Ensure an Auth0 API exists with identifier $SHOP_API_AUDIENCE and
     scope product:buy. Creates the API if missing, otherwise adds the
     scope if missing.
  2. Add the CIBA grant (urn:openid:params:grant-type:ciba) to the client
     identified by $AUTH0_CLIENT_ID, preserving any existing grants.

Environment:
  AUTH0_CLIENT_ID    Required. The Auth0 application that will receive
                     CIBA pushes.
  SHOP_API_AUDIENCE  Optional. Defaults to
                     https://api.shop-online-demo.com.
  DRY_RUN            Optional. When set to "1", print planned mutations
                     without executing them. Read-only Auth0 calls still
                     run so the script can compute the planned diff.

Pre-requisites:
  * auth0 CLI installed and logged in (`auth0 login`).
  * jq installed.
  * .env.local present (sourced automatically) or the env vars set
    in the shell.

Exit codes:
  0  success
  1  pre-flight failure
  2  unexpected runtime error
EOF
  exit 0
}

if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
  usage
fi

# ---------------------------------------------------------------------------
# Pre-flight
# ---------------------------------------------------------------------------
command -v auth0 >/dev/null 2>&1 || die "auth0 CLI not installed. Install: https://auth0.github.io/auth0-cli/"
command -v jq    >/dev/null 2>&1 || die "jq not installed. Install with: brew install jq"

if ! auth0 tenants list >/dev/null 2>&1; then
  die "Run 'auth0 login' first (auth0 tenants list failed)."
fi

# Source .env.local if present so AUTH0_CLIENT_ID etc. are picked up.
if [ -f .env.local ]; then
  set -a
  # shellcheck disable=SC1091
  . ./.env.local
  set +a
fi

: "${AUTH0_CLIENT_ID:?AUTH0_CLIENT_ID is not set. Add it to .env.local or export it.}"
: "${SHOP_API_AUDIENCE:=https://api.shop-online-demo.com}"

DRY_RUN="${DRY_RUN:-}"

CIBA_GRANT="urn:openid:params:grant-type:ciba"

# Status strings used in the final summary.
API_STATUS="unknown"
GRANT_STATUS="unknown"

# ---------------------------------------------------------------------------
# Step 1: Shop API
# ---------------------------------------------------------------------------
echo
echo "Step 1/2: Ensure Shop API ($SHOP_API_AUDIENCE) exists with scope product:buy"

APIS_JSON=$(auth0 apis list --json 2>/dev/null || echo "[]")

# Find the API by identifier; jq -e exits 1 if no match.
EXISTING_API_JSON=$(printf '%s' "$APIS_JSON" \
  | jq -c --arg aud "$SHOP_API_AUDIENCE" '.[] | select(.identifier == $aud)' 2>/dev/null || true)

if [ -z "$EXISTING_API_JSON" ]; then
  if [ "$DRY_RUN" = "1" ]; then
    info "[dry-run] would create API: name='Shop API (CIBA demo)' identifier='$SHOP_API_AUDIENCE' scopes='product:buy'"
    API_STATUS="would-create"
  else
    info "Creating API 'Shop API (CIBA demo)'..."
    auth0 apis create \
      --name "Shop API (CIBA demo)" \
      --identifier "$SHOP_API_AUDIENCE" \
      --scopes "product:buy" \
      --token-lifetime 3600 \
      --json >/dev/null
    API_STATUS="created"
  fi
else
  API_ID=$(printf '%s' "$EXISTING_API_JSON" | jq -r '.id')

  HAS_SCOPE=$(printf '%s' "$EXISTING_API_JSON" \
    | jq -r '[.scopes[]?.value] | index("product:buy") != null')

  if [ "$HAS_SCOPE" = "true" ]; then
    info "API exists with scope product:buy."
    API_STATUS="already-configured"
  else
    if [ "$DRY_RUN" = "1" ]; then
      info "[dry-run] would add scope product:buy to API id=$API_ID"
      API_STATUS="would-add"
    else
      info "Adding scope product:buy to existing API (id=$API_ID)..."
      auth0 apis scopes create "$API_ID" -s "product:buy" --json >/dev/null
      API_STATUS="scope-added"
    fi
  fi
fi

# ---------------------------------------------------------------------------
# Step 2: Client grant
# ---------------------------------------------------------------------------
echo
echo "Step 2/2: Ensure CIBA grant on client $AUTH0_CLIENT_ID"

CLIENT_JSON=$(auth0 apps show "$AUTH0_CLIENT_ID" --json 2>/dev/null) \
  || die "Failed to fetch client $AUTH0_CLIENT_ID. Verify 'auth0 apps show $AUTH0_CLIENT_ID' works in your active tenant."

EXISTING_GRANTS=$(printf '%s' "$CLIENT_JSON" | jq -c '.grant_types // []')
HAS_CIBA=$(printf '%s' "$EXISTING_GRANTS" \
  | jq -r --arg g "$CIBA_GRANT" 'index($g) != null')

# Auth0 requires async_approval_notification_channels to be configured when
# CIBA is enabled. Default to push (Guardian) — that's what this demo uses.
EXISTING_CHANNELS=$(printf '%s' "$CLIENT_JSON" \
  | jq -c '.async_approval_notification_channels // []')
HAS_CHANNEL=$(printf '%s' "$EXISTING_CHANNELS" | jq -r 'length > 0')

if [ "$HAS_CIBA" = "true" ] && [ "$HAS_CHANNEL" = "true" ]; then
  info "Client already has CIBA grant and notification channel."
  GRANT_STATUS="already-configured"
else
  MERGED_GRANTS=$(printf '%s' "$EXISTING_GRANTS" \
    | jq -c --arg g "$CIBA_GRANT" 'if index($g) then . else . + [$g] end')

  # Preserve any existing channels; default to ["push"] if none.
  CHANNELS=$(printf '%s' "$EXISTING_CHANNELS" \
    | jq -c 'if length > 0 then . else ["push"] end')

  PATCH_BODY=$(jq -nc \
    --argjson grants "$MERGED_GRANTS" \
    --argjson channels "$CHANNELS" \
    '{grant_types: $grants, async_approval_notification_channels: $channels}')

  if [ "$DRY_RUN" = "1" ]; then
    info "[dry-run] would PATCH clients/$AUTH0_CLIENT_ID with $PATCH_BODY"
    GRANT_STATUS="would-add"
  else
    info "Patching client (grants + async_approval_notification_channels)..."
    auth0 api patch "clients/$AUTH0_CLIENT_ID" --data "$PATCH_BODY" >/dev/null \
      || die "Failed to patch client (raw api patch). See message above." 2
    GRANT_STATUS="added"
  fi
fi

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
echo
echo "Summary"
echo "-------"
ok "Shop API: $API_STATUS"
ok "Client grant $CIBA_GRANT: $GRANT_STATUS"
note "Manual: confirm CIBA enabled at Tenant Settings \xE2\x86\x92 Authentication Profile"
note "Manual: enroll demo user in Guardian on a phone"

exit 0
