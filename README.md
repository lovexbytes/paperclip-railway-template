# Paperclip Railway Template

[![Deploy on Railway](https://railway.com/button.svg)](https://railway.com/deploy/<paperclip-template-slug>)

Deploy [Paperclip](https://github.com/paperclipai/paperclip) to Railway with a token-gated setup flow and strict secrets defaults.

## What you get

- Paperclip running behind a lightweight setup wrapper (`src/server.js`)
- Protected setup endpoints:
  - `/setup`
  - `/setup/api/status`
  - `/setup/api/bootstrap`
- Public health endpoint for Railway: `/setup/healthz`
- Persistent bootstrap invite storage under `/paperclip/setup/bootstrap-invite.txt`
- Strict secrets mode enabled (`PAPERCLIP_SECRETS_STRICT_MODE=true`)

## Security defaults

Use these environment values in Railway:

```env
PAPERCLIP_SECRETS_MASTER_KEY=${{secret(64, "abcdef0123456789")}}
PAPERCLIP_SECRETS_STRICT_MODE=true
PAPERCLIP_PUBLIC_URL=https://${{RAILWAY_PUBLIC_DOMAIN}}
SETUP_ENABLED=true
SETUP_TOKEN=${{secret(48, "abcdef0123456789")}}
SETUP_AUTO_BOOTSTRAP=true
PAPERCLIP_INTERNAL_PORT=3101
```

Notes:
- `PAPERCLIP_SECRETS_MASTER_KEY` must be 64 hex chars (32 bytes).
- Keep `SETUP_TOKEN` secret; it gates `/setup` and `/setup/api/*`.
- Bootstrap URL is persisted locally to avoid printing sensitive links in logs.

## Deployment flow

1. Deploy on Railway.
2. Set env vars above (or import `.env.example`).
3. Open:
   - `https://<your-domain>/setup?token=<SETUP_TOKEN>`
4. Use the setup page to fetch the bootstrap invite URL.
5. Complete initial account bootstrap.

## Healthcheck

Railway healthcheck is configured to:

- `GET /setup/healthz`

This endpoint is intentionally public for platform liveness checks.

## Runtime architecture

- Wrapper server listens on external `$PORT` (default `3100`).
- Paperclip runs internally on `PAPERCLIP_INTERNAL_PORT` (default `3101`).
- Non-setup traffic is proxied to the internal Paperclip process.
