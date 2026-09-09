ARG PAPERCLIP_IMAGE=ghcr.io/paperclipai/paperclip@sha256:f58ff8e28757eaaf1f58b7ae608e56f2a473fd0688aaab2dbade8c392fad0758
FROM ${PAPERCLIP_IMAGE}

ARG HERMES_AGENT_VERSION=latest

USER root

# Paperclip, Node, agent CLIs, the UI, and the native runner come from the
# upstream release image. This layer adds only Hermes and the Railway wrapper.
RUN if [ "${HERMES_AGENT_VERSION}" = "latest" ]; then \
      curl -fsSL https://raw.githubusercontent.com/NousResearch/hermes-agent/main/scripts/install.sh | bash -s -- --skip-setup --branch main; \
    else \
      curl -fsSL https://raw.githubusercontent.com/NousResearch/hermes-agent/main/scripts/install.sh | bash -s -- --skip-setup --branch "${HERMES_AGENT_VERSION}"; \
    fi \
  && command -v hermes \
  && hermes --version

WORKDIR /app/setup-wrapper
COPY package*.json ./
RUN npm ci --omit=dev \
  && npm cache clean --force

COPY src ./src
COPY docker-entrypoint.sh /usr/local/bin/paperclip-railway-entrypoint.sh

RUN chmod +x /usr/local/bin/paperclip-railway-entrypoint.sh \
  && test -f /app/server/dist/index.js \
  && test -f /app/server/node_modules/tsx/dist/loader.mjs \
  && test -x /app/server/dist/vendor/paperclip-runner/bin/paperclip-runnerd

ENV PAPERCLIP_DEPLOYMENT_MODE=authenticated \
  PAPERCLIP_DEPLOYMENT_EXPOSURE=public \
  PAPERCLIP_INTERNAL_PORT=3101 \
  PAPERCLIP_BACKEND_CWD=/app \
  PAPERCLIP_BACKEND_ENTRY=server/dist/index.js \
  PAPERCLIP_BACKEND_TSX_LOADER=server/node_modules/tsx/dist/loader.mjs

WORKDIR /app
EXPOSE 3100
ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/paperclip-railway-entrypoint.sh"]
