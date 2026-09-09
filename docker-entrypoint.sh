#!/usr/bin/env sh
set -eu

export HOME="${HOME:-/paperclip}"
export PAPERCLIP_HOME="${PAPERCLIP_HOME:-$HOME}"
export HOST="${HOST:-0.0.0.0}"

INSTANCE_ID="${PAPERCLIP_INSTANCE_ID:-default}"
mkdir -p "$PAPERCLIP_HOME" "$PAPERCLIP_HOME/instances/$INSTANCE_ID/logs"

# Railway usually provides only the hostname. Paperclip auth requires full URLs.
if [ -n "${RAILWAY_PUBLIC_DOMAIN:-}" ]; then
  if [ -z "${PAPERCLIP_PUBLIC_URL:-}" ]; then
    export PAPERCLIP_PUBLIC_URL="https://${RAILWAY_PUBLIC_DOMAIN}"
  fi
  if [ -z "${BETTER_AUTH_URL:-}" ]; then
    export BETTER_AUTH_URL="https://${RAILWAY_PUBLIC_DOMAIN}"
  fi
fi

# Preserve the official image's UID/GID remapping, mounted-volume ownership
# repair, and privilege drop before starting the Railway wrapper.
exec /usr/local/bin/docker-entrypoint.sh node /app/setup-wrapper/src/server.js
