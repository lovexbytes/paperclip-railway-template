# Paperclip Railway Template

[![Deploy on Railway](https://railway.com/button.svg)](https://railway.com/deploy/paperclip-1?referralCode=uTN7AS&utm_medium=integration&utm_source=template&utm_campaign=generic)

Deploy Paperclip to Railway with durable storage and a first-admin setup wrapper.

## Architecture

- Paperclip comes from the official, release-tested upstream image rather than being rebuilt from source.
- The default image is Paperclip `v2026.1106.0`, pinned by multi-architecture OCI digest.
- The template adds only Hermes and the Railway setup wrapper.
- The wrapper (`src/server.js`) owns the public port and starts Paperclip internally on `PAPERCLIP_INTERNAL_PORT` (default `3101`).
- `/` redirects to `/setup` until the first `instance_admin` exists.
- Setup/bootstrap is wrapper + PostgreSQL native; it does not depend on Paperclip CLI onboarding.
- The official image supplies Paperclip, its UI, migrations, native runner, Codex, Claude, Gemini, OpenCode, Kimi, Git, and GitHub CLI.
- Railway IaC owns the PostgreSQL service and a persistent volume mounted at `/paperclip`.

## Pinned upstream image

```text
ghcr.io/paperclipai/paperclip@sha256:d6584f05cf57a4b26c117eb083725f18c1fe69ddafa7d16c9f8cce83f6fa17da
```

This is the multi-architecture digest for upstream release `v2026.1106.0`, source commit:

```text
d69631b01b9c658f80bf8bed389863dce82643e1
```

Do not replace the digest with `latest`. Upgrade by auditing a stable release, testing its database migrations, and then changing the digest.

## Railway Infrastructure as Code

Railway configuration lives in `.railway/railway.ts` and owns:

- the `paperclip` service;
- the `Postgres` database;
- the `paperclip-data` volume mounted at `/paperclip`;
- the backend-aware `/wrapper/healthz` deployment readiness check.

After linking the repository to the intended Railway project and environment:

```bash
# Requires Railway CLI 5.42.1+ installed and authenticated.
railway --version
npm install
npm run railway:plan
npm run railway:apply
```

Review the complete plan before applying it. `railway:apply` changes the linked environment and must not be run blindly against an existing deployment that already has separately managed database or volume resources.

## Build arguments

- `PAPERCLIP_IMAGE` — official Paperclip OCI image reference; default is the pinned `v2026.1106.0` digest above.
- `HERMES_AGENT_VERSION` — exact `hermes-agent` PyPI version installed into `/opt/hermes`; default `0.19.0`.

## Required Railway variables

The public Railway template should configure:

- `SETUP_TOKEN="${{secret(48, \"abcdef0123456789\")}}"`
- `SETUP_ENABLED="true"`
- `SETUP_AUTO_BOOTSTRAP="true"`
- `BETTER_AUTH_SECRET="${{secret(64, \"abcdef0123456789\")}}"`
- `PAPERCLIP_AGENT_JWT_SECRET="${{secret(64, \"abcdef0123456789\")}}"`
- `PAPERCLIP_PUBLIC_URL="https://${{RAILWAY_PUBLIC_DOMAIN}}"`
- `BETTER_AUTH_URL="https://${{RAILWAY_PUBLIC_DOMAIN}}"`
- `PAPERCLIP_INTERNAL_PORT="3101"`
- `PAPERCLIP_SECRETS_MASTER_KEY="${{secret(64, \"abcdef0123456789\")}}"`
- `PAPERCLIP_SECRETS_STRICT_MODE="true"`

For public authenticated deployments, the wrapper refuses to start when `SETUP_TOKEN` is missing or empty.

`.railway/railway.ts` wires `DATABASE_URL` from its PostgreSQL resource. The entrypoint derives the two public URL variables from `RAILWAY_PUBLIC_DOMAIN` when they are absent, but explicit template values remain preferred.

Keep `PAPERCLIP_AGENT_JWT_SECRET` explicit even though Paperclip can fall back to `BETTER_AUTH_SECRET`; local-agent runs need signing material to receive short-lived `PAPERCLIP_API_KEY` credentials.

## First deployment

1. Deploy with the Dockerfile builder and leave Railway Start Command empty.
2. Confirm the volume is mounted at `/paperclip` and PostgreSQL is healthy.
3. Open `<public_url>/setup`.
4. Copy `SETUP_TOKEN` from Railway Variables and paste it into the setup UI.
5. Generate the first-admin invite and complete signup.
6. Confirm `/` opens the application after onboarding.

## Upgrade from an earlier pin

The jump from `v2026.831.1` to `v2026.1106.0` applies 144 database migrations (`0231`–`0374`). Some discard data (`0231`, `0236`, `0289`), some rewrite large tables (`0285`, `0312`), and some run long backfills or concurrent index builds. Upstream treats a downgrade as a restore. Redeploying the old image alone is not a safe rollback after migration.

Old and new Paperclip processes must never write to `/paperclip` at the same time (the workspace restore lock protocol changed in `v2026.1012.0`). Stop the old deployment before the new one starts, for upgrade and for rollback.

Behavior changes to review in the upstream release notes before rollout: execution harnesses default to full auto, @-mentions no longer start a run, budgets block on unpriced usage, the Operator role gains company-editing grants, legacy Composio connections and Pipelines are removed, and new agents default to the native Runner.

Before production rollout:

1. Take a PostgreSQL snapshot or logical backup, back up the `/paperclip` volume, and record the deployed image/ref.
2. Restore that backup into a staging database.
3. Deploy this image against staging and let Paperclip apply migrations. Confirm they finish inside the 300-second Railway healthcheck timeout.
4. Verify login, board reads/writes, attachments, setup status, and at least one configured local-agent run.
5. Only then deploy to production.

Rollback requires both:

- redeploying the previous image/ref; and
- restoring the matching pre-upgrade PostgreSQL snapshot.

The `/paperclip` volume should be backed up separately when it contains attachments, workspaces, credentials, or other local state.

## Endpoints and smoke checks

- `/setup`
- `/setup/api/status`
- `/setup/api/bootstrap`
- `/wrapper/healthz`
- `/setup/healthz`

```bash
curl -fsS https://<domain>/wrapper/healthz
curl -fsS https://<domain>/setup/api/status
curl -fsS https://<domain>/api/health
```

`/wrapper/healthz` returns `503` until Paperclip's `/api/health` succeeds, so Railway does not promote a wrapper whose backend is unavailable. `/setup/healthz` remains the wrapper-only liveness endpoint and reports backend state in its response body.

## Storage

Paperclip defaults to local-disk object storage beneath `/paperclip`. The checked-in Railway IaC mounts persistent storage there, preserving attachments and other instance files across redeploys. PostgreSQL does not contain attachment bodies.

For externally managed deployments, either mount durable storage at `/paperclip` or configure Paperclip’s S3 storage provider. Never run production attachments on an ephemeral container filesystem.

## Troubleshooting

### Missing auth secret

If logs show:

```text
authenticated mode requires BETTER_AUTH_SECRET (or PAPERCLIP_AGENT_JWT_SECRET) to be set
```

Set both secrets and redeploy. Generate independent values with:

```bash
openssl rand -base64 48
```

### Setup API is missing

If `/setup/api/status` returns `{"error":"API route not found"}`, requests are hitting native Paperclip routes rather than the wrapper. Confirm:

- Railway Start Command is empty;
- the image entrypoint is `/usr/local/bin/paperclip-railway-entrypoint.sh` through `tini`;
- the healthcheck path is `/wrapper/healthz`.
