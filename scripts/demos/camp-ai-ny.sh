#!/usr/bin/env bash
#
# scripts/demos/camp-ai-ny.sh
#
# Reset, verify, and operate state for the Camp AI NY demo (agent/user
# identity + Token Vault + CIBA, Mac Mini buy scenario).
#
# Subcommands:
#   reset        Clear active sales (shop-api) and Watchlist rows (postgres).
#                Reminds the operator to click Disconnect on /profile to drop
#                the Token Vault Google grant for a clean cold start.
#   check        Verify shop-api up, postgres reachable, Auth0 client has
#                CIBA grant + guardian-push channel, Mac Mini in catalog,
#                and SEED_GMAIL_* vars present.
#   trigger      POST /api/cron/check-watchlists with CRON_SECRET to fire
#                the watchlist tick on demand.
#   seed-gmail   Insert canned investor emails into the demo inbox via
#                scripts/demos/seed-gmail.ts.
#   clear-gmail  Trash any seeded demo emails (idempotent).
#
# Env vars consumed (loaded from .env.local if present):
#   SHOP_API_URL              defaults to http://localhost:8000/api/shop
#   ADMIN_API_KEY             required for `reset`
#   AUTH0_CLIENT_ID           required for `check`
#   CRON_SECRET               required for `trigger`
#   APP_BASE_URL              defaults to http://localhost:3000 (used by `trigger`)
#   SEED_GMAIL_CLIENT_ID      required for `seed-gmail` and `clear-gmail`
#   SEED_GMAIL_CLIENT_SECRET  required for `seed-gmail` and `clear-gmail`
#   SEED_GMAIL_REFRESH_TOKEN  required for `seed-gmail` and `clear-gmail`
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
    echo -e "${RED}camp-ai-ny.sh exited with status $rc${RESET}" >&2
    exit 2
  fi
}
trap cleanup EXIT

# ---------------------------------------------------------------------------
# Usage
# ---------------------------------------------------------------------------
usage() {
  cat <<'EOF'
Usage: scripts/demos/camp-ai-ny.sh <subcommand>

Subcommands:
  reset        Clear active sales (shop-api) and Watchlist rows (postgres).
               Prints a reminder to click Disconnect on /profile so the
               next demo run starts cold for Token Vault as well.
  check        Verify the demo's preflight: shop-api reachable, postgres
               reachable and Watchlist table present, Auth0 client has CIBA
               grant + guardian-push channel, Mac Mini in shop catalog, and
               SEED_GMAIL_* env vars set. Exits non-zero on any failure.
  trigger      Fire the watchlist cron tick on demand (POST
               /api/cron/check-watchlists with CRON_SECRET). Use this on
               stage to demo CIBA without waiting for the Vercel cron.
  seed-gmail   Insert ~5 canned investor emails into the demo Gmail inbox.
               Each subject contains [demo:camp-ai-ny] for later cleanup.
  clear-gmail  Trash all seeded demo emails. Idempotent.

Examples:
  pnpm demo:camp-ai-ny check
  pnpm demo:camp-ai-ny seed-gmail
  pnpm demo:camp-ai-ny reset
  pnpm demo:camp-ai-ny trigger
  pnpm demo:camp-ai-ny clear-gmail

Env vars (loaded from .env.local):
  SHOP_API_URL              defaults to http://localhost:8000/api/shop
  ADMIN_API_KEY             required for `reset`
  AUTH0_CLIENT_ID           required for `check`
  CRON_SECRET               required for `trigger`
  APP_BASE_URL              defaults to http://localhost:3000 (used by `trigger`)
  SEED_GMAIL_CLIENT_ID      required for `seed-gmail` and `clear-gmail`
  SEED_GMAIL_CLIENT_SECRET  required for `seed-gmail` and `clear-gmail`
  SEED_GMAIL_REFRESH_TOKEN  required for `seed-gmail` and `clear-gmail`
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
  echo
  note "Don't forget the Token Vault side of the reset:"
  info "open http://localhost:3000/profile and click Disconnect on the Google account"
  info "(no programmatic helper exists; this is the same path the user would take)"
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
  if curl -fsS --max-time 5 "${SHOP_API_URL}/search?product=mac" >/dev/null 2>&1; then
    ok "shop-api reachable at ${SHOP_API_URL}"
  else
    fail "shop-api not reachable at ${SHOP_API_URL}/search (is docker compose up?)"
    failed=1
  fi

  # Check 2: Mac Mini in catalog
  if curl -fsS --max-time 5 "${SHOP_API_URL}/products/mac-mini-m4/history" >/dev/null 2>&1; then
    ok "Mac Mini M4 in shop catalog (price history endpoint live)"
  else
    fail "Mac Mini M4 missing from shop catalog (restart shop-api after editing catalog.json:"
    info "docker compose up -d --force-recreate shop-api)"
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

  # Check 6: SEED_GMAIL_* env vars
  if [ -n "${SEED_GMAIL_CLIENT_ID:-}" ] \
      && [ -n "${SEED_GMAIL_CLIENT_SECRET:-}" ] \
      && [ -n "${SEED_GMAIL_REFRESH_TOKEN:-}" ]; then
    ok "SEED_GMAIL_* env vars present"
  else
    fail "SEED_GMAIL_* env vars missing — seed-gmail will not run"
    info "see docs/demos/camp-ai-ny.md \"Pre-flight\" for one-time setup via OAuth Playground"
    failed=1
  fi

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
  # Capture body separately from status so we can show error responses
  # instead of swallowing them with `curl -f`.
  local response_file http_code
  response_file=$(mktemp)
  http_code=$(curl -sS --max-time 100 -X POST \
    -H "Authorization: Bearer $CRON_SECRET" \
    -o "$response_file" \
    -w "%{http_code}" \
    "${app_base}/api/cron/check-watchlists" || echo "000")

  if [ "$http_code" -ge 200 ] && [ "$http_code" -lt 300 ]; then
    jq . "$response_file"
    rm -f "$response_file"
  else
    fail "cron returned HTTP $http_code"
    if [ -s "$response_file" ]; then
      info "response body:"
      sed 's/^/    /' "$response_file" >&2
    fi
    rm -f "$response_file"
    exit 1
  fi
}

# ---------------------------------------------------------------------------
# seed-gmail / clear-gmail
# ---------------------------------------------------------------------------
do_seed_gmail() {
  command -v pnpm >/dev/null 2>&1 || die "pnpm not installed."
  load_env

  : "${SEED_GMAIL_CLIENT_ID:?SEED_GMAIL_CLIENT_ID is not set. See docs/demos/camp-ai-ny.md.}"
  : "${SEED_GMAIL_CLIENT_SECRET:?SEED_GMAIL_CLIENT_SECRET is not set.}"
  : "${SEED_GMAIL_REFRESH_TOKEN:?SEED_GMAIL_REFRESH_TOKEN is not set.}"

  note "Inserting canned investor emails into the demo Gmail inbox..."
  pnpm tsx scripts/demos/seed-gmail.ts seed
}

do_clear_gmail() {
  command -v pnpm >/dev/null 2>&1 || die "pnpm not installed."
  load_env

  : "${SEED_GMAIL_CLIENT_ID:?SEED_GMAIL_CLIENT_ID is not set.}"
  : "${SEED_GMAIL_CLIENT_SECRET:?SEED_GMAIL_CLIENT_SECRET is not set.}"
  : "${SEED_GMAIL_REFRESH_TOKEN:?SEED_GMAIL_REFRESH_TOKEN is not set.}"

  note "Trashing any seeded demo emails..."
  pnpm tsx scripts/demos/seed-gmail.ts clear
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
  seed-gmail)
    do_seed_gmail
    ;;
  clear-gmail)
    do_clear_gmail
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
