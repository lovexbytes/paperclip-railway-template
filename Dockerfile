ARG PAPERCLIP_IMAGE=ghcr.io/paperclipai/paperclip@sha256:d6584f05cf57a4b26c117eb083725f18c1fe69ddafa7d16c9f8cce83f6fa17da
FROM ${PAPERCLIP_IMAGE}

ARG HERMES_AGENT_VERSION=0.19.0

USER root

# Paperclip, Node, agent CLIs, the UI, and the native runner come from the
# upstream release image. This layer adds only Hermes and the Railway wrapper.
# Hermes lives in /opt, not $HOME (/paperclip): the persistent volume mounts
# over /paperclip at runtime and would hide anything installed there.
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3-venv \
  && rm -rf /var/lib/apt/lists/* \
  && python3 -m venv /opt/hermes \
  && /opt/hermes/bin/pip install --no-cache-dir "hermes-agent==${HERMES_AGENT_VERSION}" \
  && ln -sf /opt/hermes/bin/hermes /usr/local/bin/hermes \
  && command -v hermes \
  && hermes --version

WORKDIR /app/setup-wrapper
COPY package*.json ./
RUN npm ci --omit=dev \
  && npm cache clean --force

COPY src ./src
COPY docker-entrypoint.sh /usr/local/bin/paperclip-railway-entrypoint.sh

RUN chmod +x /usr/local/bin/paperclip-railway-entrypoint.sh \
  && test -f /app/server/dist-runtime/index.mjs \
  && test -x /app/server/dist/vendor/paperclip-runner/bin/paperclip-runnerd

ENV PAPERCLIP_DEPLOYMENT_MODE=authenticated \
  PAPERCLIP_DEPLOYMENT_EXPOSURE=public \
  PAPERCLIP_INTERNAL_PORT=3101 \
  PAPERCLIP_BACKEND_CWD=/app \
  PAPERCLIP_BACKEND_ENTRY=server/dist-runtime/index.mjs

WORKDIR /app
EXPOSE 3100
ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/paperclip-railway-entrypoint.sh"]
