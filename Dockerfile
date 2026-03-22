FROM node:20-bookworm-slim

ARG PAPERCLIP_VERSION=latest

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl tini \
  && rm -rf /var/lib/apt/lists/*

RUN npm install --global --omit=dev paperclipai@${PAPERCLIP_VERSION}

ENV NODE_ENV=production \
  HOME=/paperclip \
  PAPERCLIP_HOME=/paperclip \
  HOST=0.0.0.0 \
  PORT=3100 \
  PAPERCLIP_DEPLOYMENT_MODE=authenticated \
  PAPERCLIP_DEPLOYMENT_EXPOSURE=public \
  PAPERCLIP_INTERNAL_PORT=3101

WORKDIR /app

COPY package.json /app/package.json
COPY src /app/src
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh \
  && mkdir -p /paperclip

EXPOSE 3100

ENTRYPOINT ["/usr/bin/tini", "--", "docker-entrypoint.sh"]
CMD ["node", "src/server.js"]
