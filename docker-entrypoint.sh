#!/usr/bin/env sh
set -eu

export HOME="${HOME:-/paperclip}"
export PAPERCLIP_HOME="${PAPERCLIP_HOME:-$HOME}"
export HOST="${HOST:-0.0.0.0}"

INSTANCE_ID="${PAPERCLIP_INSTANCE_ID:-default}"
CONFIG_PATH="${PAPERCLIP_CONFIG:-$PAPERCLIP_HOME/instances/$INSTANCE_ID/config.json}"

mkdir -p "$PAPERCLIP_HOME"

# Railway usually provides only the hostname. Paperclip needs a full public URL
# for authenticated/public mode onboarding.
if [ -z "${PAPERCLIP_PUBLIC_URL:-}" ] && [ -n "${RAILWAY_PUBLIC_DOMAIN:-}" ]; then
  export PAPERCLIP_PUBLIC_URL="https://${RAILWAY_PUBLIC_DOMAIN}"
fi

if [ ! -f "$CONFIG_PATH" ]; then
  echo "[entrypoint] No Paperclip config at $CONFIG_PATH. Running first-time onboarding..."
  paperclipai onboard --yes
fi

echo "[entrypoint] Starting Paperclip"
exec "$@"
