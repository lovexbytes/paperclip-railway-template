# Paperclip Railway Template

[![Deploy on Railway](https://railway.com/button.svg)](https://railway.com/deploy/paperclip-1?referralCode=uTN7AS&utm_medium=integration&utm_source=template&utm_campaign=generic)

Deploy Paperclip to Railway with durable storage and a first-admin setup wrapper.

## Architecture

- Paperclip comes from the official, release-tested upstream image rather than being rebuilt from source.
- The default image is Paperclip `v2026.831.1`, pinned by multi-architecture OCI digest.
- The template adds only Hermes and the Railway setup wrapper.
- The wrapper (`src/server.js`) owns the public port and starts Paperclip internally on `PAPERCLIP_INTERNAL_PORT` (default `3101`).
- `/` redirects to `/setup` until the first `instance_admin` exists.
- Setup/bootstrap is wrapper + PostgreSQL native; it does not depend on Paperclip CLI onboarding.
- The official image supplies Paperclip, its UI, migrations, native runner, Codex, Claude, Gemini, OpenCode, Kimi, Git, and GitHub CLI.
- Railway IaC owns the PostgreSQL service and a persistent volume mounted at `/paperclip`.

## Pinned upstream image

```text
ghcr.io/paperclipai/paperclip@sha256:f58ff8e28757eaaf1f58b7ae608e56f2a473fd0688aaab2dbade8c392fad0758
```

This is the multi-architecture digest for upstream release `v2026.831.1`, source commit:

```text
65ec059bde30d98c92165b24a30a540800dd1f6f
```

Do not replace the digest with `latest`. Upgrade by auditing a stable release, testing its database migrations, and then changing the digest.

## Railway Infrastructure as Code

Railway configuration lives in `.railway/railway.ts` and owns:

- the `paperclip` service;
- the `Postgres` database;
- the `paperclip-data` volume mounted at `/paperclip`;
- the wrapper-specific `/wrapper/healthz` deployment healthcheck.

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

- `PAPERCLIP_IMAGE` — official Paperclip OCI image reference; default is the pinned `v2026.831.1` digest above.
- `HERMES_AGENT_VERSION` — Hermes branch/tag installed into the extension image; default `latest`.

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

`.railway/railway.ts` wires `DATABASE_URL` from its PostgreSQL resource. The entrypoint derives the two public URL variables from `RAILWAY_PUBLIC_DOMAIN` when they are absent, but explicit template values remain preferred.

Keep `PAPERCLIP_AGENT_JWT_SECRET` explicit even though Paperclip can fall back to `BETTER_AUTH_SECRET`; local-agent runs need signing material to receive short-lived `PAPERCLIP_API_KEY` credentials.

## First deployment

1. Deploy with the Dockerfile builder and leave Railway Start Command empty.
2. Confirm the volume is mounted at `/paperclip` and PostgreSQL is healthy.
3. Open `<public_url>/setup`.
4. Copy `SETUP_TOKEN` from Railway Variables and paste it into the setup UI.
5. Generate the first-admin invite and complete signup.
6. Confirm `/` opens the application after onboarding.

## Upgrade from the old source-built template

The jump from `v2026.325.0` to `v2026.831.1` includes many database migrations, including destructive migrations. Redeploying the old image alone is not a safe rollback after migration.

Before production rollout:

1. Take a PostgreSQL snapshot or logical backup and record the deployed image/ref.
2. Restore that backup into a staging database.
3. Deploy this image against staging and let Paperclip apply migrations.
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

Check response bodies, not only HTTP status. The wrapper health endpoint reports `backendReachable`; Railway currently uses the wrapper endpoint so the setup UI can remain reachable while Paperclip starts.

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
