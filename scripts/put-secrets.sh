#!/usr/bin/env bash
# Uploads the Worker's production secrets to Cloudflare without printing them.
# - APP_SECRET: a fresh random secret for invite links, kept in worker/.prod.vars (git-ignored).
# - DEEPINFRA_API_KEY, RESEND_API_KEY, ALERT_EMAIL: copied from worker/.dev.vars.
set -euo pipefail
cd "$(dirname "$0")/.."

if [ ! -f worker/.prod.vars ]; then
  printf 'APP_SECRET=%s\n' "$(openssl rand -base64 32 | tr '+/' '-_' | tr -d '=')" > worker/.prod.vars
  echo "Made a new production secret in worker/.prod.vars"
fi

get() { sed -n "s/^$1=//p" "$2" | tr -d '"'"'"' \r'; }
put() {
  [ -n "$2" ] || { echo "Missing $1"; exit 1; }
  printf '%s' "$2" | npx wrangler secret put "$1" --config worker/wrangler.toml >/dev/null
  echo "Set $1"
}

put APP_SECRET "$(get APP_SECRET worker/.prod.vars)"
for k in DEEPINFRA_API_KEY RESEND_API_KEY ALERT_EMAIL; do put "$k" "$(get "$k" worker/.dev.vars)"; done
