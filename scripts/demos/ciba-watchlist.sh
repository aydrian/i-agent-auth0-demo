#!/usr/bin/env bash
#
# scripts/demos/ciba-watchlist.sh
#
# Reset and verify state for the CIBA price-drop watchlist demo.
#
# Subcommands:
#   reset    Clear active sales (shop-api) and Watchlist rows (postgres).
#   check    Verify shop-api is up, postgres is reachable, Auth0 client has
#            the CIBA grant + guardian-push channel.
#   trigger  POST /api/cron/check-watchlists with CRON_SECRET to fire the
#            watchlist tick on demand (skips the Vercel schedule).
#
# Env vars consumed (loaded from .env.local if present):
#   POSTGRES_URL       (used only as a sanity check; the script uses
#                      `docker compose exec postgres psql ...` so it
#                      doesn't actually need POSTGRES_URL to connect)
#   SHOP_API_URL       e.g. http://localhost:8000/api/shop
#   ADMIN_API_KEY      shop-api admin endpoint key
#   AUTH0_CLIENT_ID    used by the `check` subcommand for grant verification
#   CRON_SECRET        used by the `trigger` subcommand
#   APP_BASE_URL       defaults to http://localhost:3000 (used by `trigger`)
#
# Exit codes:
#   0  success
#   1  pre-flight failure (missing deps, missing env, subcommand error)
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
fail() { echo -e "${RED}\xE2\x9C\x97${RESET} $*"; }
note() { echo -e "${YELLOW}\xE2\x86\x92${RESET} $*"; }
info() { echo "  $*"; }

# ---------------------------------------------------------------------------
# Cleanup / trap
# ---------------------------------------------------------------------------
cleanup() {
  local rc=$?
  if [ "$rc" -ne 0 ] && [ "$rc" -ne 1 ]; then
    echo -e "${RED}ciba-watchlist.sh exited with status $rc${RESET}" >&2
    exit 2
  fi
}
trap cleanup EXIT

# ---------------------------------------------------------------------------
# Usage
# ---------------------------------------------------------------------------
usage() {
  cat <<'EOF'
Usage: scripts/demos/ciba-watchlist.sh <subcommand>

Subcommands:
  reset    Clear active sales (shop-api) and all rows from the Watchlist table.
           Safe to run any time. Use between demo takes.
  check    Verify the demo's preflight: shop-api reachable, postgres reachable
           and Watchlist table present, Auth0 client has CIBA grant and
           guardian-push channel. Exits non-zero on any failure.
  trigger  Fire the watchlist cron tick on demand (POST /api/cron/check-watchlists
           with CRON_SECRET). Useful in live demos to skip waiting for the
           Vercel cron schedule. Returns the per-watch JSON summary.

Examples:
  pnpm demo:ciba-watchlist reset
  pnpm demo:ciba-watchlist check
  pnpm demo:ciba-watchlist trigger

Env vars (loaded from .env.local):
  SHOP_API_URL      defaults to http://localhost:8000/api/shop
  ADMIN_API_KEY     required for `reset`
  AUTH0_CLIENT_ID   required for `check`
  CRON_SECRET       required for `trigger`
  APP_BASE_URL      defaults to http://localhost:3000 (used by `trigger`)
EOF
}

# ---------------------------------------------------------------------------
# Env loading
# ---------------------------------------------------------------------------
load_env() {
  if [ -f .env.local ]; then
    set -a
    # shellcheck disable=SC1091
    . ./.env.local
    set +a
  fi
  : "${SHOP_API_URL:=http://localhost:8000/api/shop}"
}

# ---------------------------------------------------------------------------
# reset
# ---------------------------------------------------------------------------
do_reset() {
  command -v curl >/dev/null 2>&1 || die "curl not installed."
  command -v jq   >/dev/null 2>&1 || die "jq not installed. Install with: brew install jq"

  load_env

  : "${ADMIN_API_KEY:?ADMIN_API_KEY is not set. Add it to .env.local or export it.}"

  note "Clearing active sales via ${SHOP_API_URL}/admin/sales..."
  local sales_json
  sales_json=$(curl -fsS --max-time 5 "${SHOP_API_URL}/admin/sales" -H "X-Admin-Key: $ADMIN_API_KEY" \
    || die "Failed to reach shop-api at ${SHOP_API_URL}/admin/sales (is docker compose up?)")

  local sale_count=0
  local product_id
  for product_id in $(printf '%s' "$sales_json" | jq -r 'keys[]?'); do
    curl -fsS --max-time 5 -X DELETE -H "X-Admin-Key: $ADMIN_API_KEY" \
      "${SHOP_API_URL}/admin/sale/${product_id}" >/dev/null \
      || die "Failed to clear sale for productId=${product_id}"
    sale_count=$((sale_count + 1))
  done

  note "Clearing Watchlist rows via docker compose exec postgres..."
  local psql_err
  psql_err=$(mktemp)
  if ! docker compose exec -T postgres \
      psql -U postgres -d chatbot -c 'DELETE FROM "Watchlist";' \
      >/dev/null 2>"$psql_err"; then
    cat "$psql_err" >&2
    rm -f "$psql_err"
    die "Failed to clear Watchlist table (is the postgres container running?)"
  fi
  rm -f "$psql_err"

  ok "Cleared $sale_count active sales"
  ok "Cleared all rows from \"Watchlist\" table"
}

# ---------------------------------------------------------------------------
# check
# ---------------------------------------------------------------------------
do_check() {
  command -v curl  >/dev/null 2>&1 || die "curl not installed."
  command -v jq    >/dev/null 2>&1 || die "jq not installed. Install with: brew install jq"
  command -v auth0 >/dev/null 2>&1 || die "auth0 CLI not installed. Install: https://auth0.github.io/auth0-cli/"

  load_env

  : "${AUTH0_CLIENT_ID:?AUTH0_CLIENT_ID is not set. Add it to .env.local or export it.}"

  local failed=0

  # Check 1: shop-api responds
  if curl -fsS --max-time 5 "${SHOP_API_URL}/search?product=iphone" >/dev/null 2>&1; then
    ok "shop-api reachable at ${SHOP_API_URL}"
  else
    fail "shop-api not reachable at ${SHOP_API_URL}/search (is docker compose up?)"
    failed=1
  fi

  # Check 2: shop-api price history endpoint
  if curl -fsS --max-time 5 "${SHOP_API_URL}/products/iphone-15-pro/history" >/dev/null 2>&1; then
    ok "shop-api price history endpoint live"
  else
    fail "shop-api price history endpoint failed (need /products/{id}/history; is shop-api up to date?)"
    failed=1
  fi

  # Check 3: postgres reachable + Watchlist table exists
  if docker compose exec -T postgres \
      psql -U postgres -d chatbot -c '\d "Watchlist"' >/dev/null 2>&1; then
    ok "postgres reachable and Watchlist table present"
  else
    fail "postgres not reachable or Watchlist table missing (run pnpm db:migrate?)"
    failed=1
  fi

  # Fetch client JSON once for both Auth0 checks. Close stdin so the CLI
  # can't block on an interactive re-auth prompt when its refresh token is
  # stale; capture stderr so we can give a specific hint on failure.
  local client_json auth0_err
  auth0_err=$(mktemp)
  client_json=$(auth0 apps show "$AUTH0_CLIENT_ID" --json </dev/null 2>"$auth0_err" || true)

  if [ -z "$client_json" ]; then
    if grep -qiE 'log in|re-authorize|access_denied|refresh' "$auth0_err"; then
      fail "auth0 CLI session expired or invalid. Run: auth0 login"
    else
      fail "auth0 apps show \"$AUTH0_CLIENT_ID\" failed:"
      sed 's/^/    /' "$auth0_err" >&2
    fi
    failed=1
  else
    # Check 4: CIBA grant
    if printf '%s' "$client_json" \
        | jq -e '.grant_types | index("urn:openid:params:grant-type:ciba")' >/dev/null 2>&1; then
      ok "Auth0 client has CIBA grant (urn:openid:params:grant-type:ciba)"
    else
      fail "Auth0 client missing CIBA grant (run pnpm setup:auth0)"
      failed=1
    fi

    # Check 5: guardian-push channel
    if printf '%s' "$client_json" \
        | jq -e '.async_approval_notification_channels | index("guardian-push")' >/dev/null 2>&1; then
      ok "Auth0 client has guardian-push notification channel"
    else
      fail "Auth0 client missing guardian-push channel (run pnpm setup:auth0)"
      failed=1
    fi
  fi
  rm -f "$auth0_err"

  if [ "$failed" -ne 0 ]; then
    echo
    die "One or more preflight checks failed. See errors above."
  fi

  echo
  ok "All preflight checks passed"
}

# ---------------------------------------------------------------------------
# trigger
# ---------------------------------------------------------------------------
do_trigger() {
  command -v curl >/dev/null 2>&1 || die "curl not installed."
  command -v jq   >/dev/null 2>&1 || die "jq not installed. Install with: brew install jq"

  load_env

  : "${CRON_SECRET:?CRON_SECRET is not set. Add it to .env.local or export it.}"
  local app_base="${APP_BASE_URL:-http://localhost:3000}"

  note "POST ${app_base}/api/cron/check-watchlists ..."
  # The cron route may block up to ~90s waiting on Guardian approval.
  curl -fsS --max-time 100 -X POST \
    -H "Authorization: Bearer $CRON_SECRET" \
    "${app_base}/api/cron/check-watchlists" \
    | jq .
}

# ---------------------------------------------------------------------------
# Dispatch
# ---------------------------------------------------------------------------
case "${1:-}" in
  reset)
    do_reset
    ;;
  check)
    do_check
    ;;
  trigger)
    do_trigger
    ;;
  ""|--help|-h)
    usage
    exit 0
    ;;
  *)
    echo "unknown subcommand: $1" >&2
    echo >&2
    usage >&2
    exit 1
    ;;
esac

exit 0
