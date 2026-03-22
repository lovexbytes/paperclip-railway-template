# Paperclip Railway Template

[![Deploy on Railway](https://railway.com/button.svg)](https://railway.com/deploy/<paperclip-template-slug>)

Deploy [Paperclip](https://github.com/paperclipai/paperclip) to Railway with persistent state and template-preconfigured infrastructure.

This template runs Paperclip from the published npm package (`paperclipai`) and bootstraps onboarding automatically on first run.

## What you get

- Paperclip service running on Railway
- First-boot onboarding built into entrypoint
- Persistent app state on a Railway volume mounted at `/paperclip`
- Public URL support via `PAPERCLIP_PUBLIC_URL` (or auto-derived from Railway domain)
- Healthcheck preconfigured at `/api/health`

## How it works

1. You deploy using the Railway template link.
2. Railway provisions the service with template defaults.
3. On first boot, entrypoint initializes Paperclip state under `/paperclip`.
4. On future boots, persisted state is reused.
5. Service health is checked via `/api/health`.

## Railway deploy instructions

1. Click the deploy button above.
2. Set template variables (or keep defaults).
3. Deploy.
4. Open your service URL and verify `/api/health`.

Template expectations:

- Persistent volume mounted at `/paperclip`
- Public networking enabled
- Single replica (stateful default)

## Default environment variables

Recommended template variables:

```env
PAPERCLIP_SECRETS_MASTER_KEY=${{secret(64, "abcdef0123456789")}}
PAPERCLIP_SECRETS_STRICT_MODE=true
PAPERCLIP_PUBLIC_URL=https://${{RAILWAY_PUBLIC_DOMAIN}}
```

Notes:
- `PAPERCLIP_SECRETS_MASTER_KEY` should be a 32-byte key (64 hex chars).
- `PAPERCLIP_PUBLIC_URL` is wired to `RAILWAY_PUBLIC_DOMAIN`, which Railway auto-supplies when a public domain is enabled for the service.
- Optional alternative: `PAPERCLIP_SECRETS_MASTER_KEY_FILE` for file-based key loading.

Runtime variables commonly used:

- `PORT` (injected by Railway)
- `OPENAI_API_KEY` (optional)
- `ANTHROPIC_API_KEY` (optional)

## Runtime behavior

Entrypoint (`docker-entrypoint.sh`) does the following:

- Ensures `/paperclip` exists and is writable
- Runs onboarding automatically when no existing config is found
- Derives `PAPERCLIP_PUBLIC_URL` from `RAILWAY_PUBLIC_DOMAIN` if not provided
- Starts Paperclip on `$PORT`

## Simple usage guide

After deploy:

1. Open the generated public URL.
2. Confirm health endpoint responds: `/api/health`.
3. Complete onboarding (if prompted).
4. Restart once and verify data persists.

## Troubleshooting

- Service restarts repeatedly:
  - Check logs for startup errors.
  - Verify volume mount exists at `/paperclip`.
  - Verify app is listening on `$PORT`.

- Data resets after redeploy:
  - Confirm volume is mounted at `/paperclip`.
  - Confirm app is writing state under `/paperclip`.

- Public URL is incorrect:
  - Set `PAPERCLIP_PUBLIC_URL` explicitly.
  - Or verify `RAILWAY_PUBLIC_DOMAIN` is present.

## Build pinning

Docker build arg:

- `PAPERCLIP_VERSION` (default: `latest`)

Override in Railway if you want to pin a specific Paperclip release.
