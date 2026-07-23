# syntax=docker/dockerfile:1.7

FROM node:24-bookworm-slim AS build
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@11.9.0 --activate
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm local:prepare

FROM node:24-bookworm-slim AS native-dependencies
WORKDIR /runtime
COPY package.json ./
RUN apt-get update \
  && apt-get install -y --no-install-recommends build-essential python3 \
  && npm install --omit=dev --no-save better-sqlite3@12.9.0 sharp@0.35.3 \
  && rm -rf /var/lib/apt/lists/* /root/.npm

FROM node:24-bookworm-slim AS runtime
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates ffmpeg \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json ./
COPY --from=native-dependencies /runtime/node_modules ./node_modules
COPY --from=build /app/apps/server/dist ./apps/server/dist
COPY --from=build /app/apps/studio/dist ./apps/studio/dist
COPY --from=build /app/resources/demo/xingque ./resources/demo/xingque
RUN mkdir -p /data /tmp/aigc-director \
  && chown -R node:node /data /tmp/aigc-director

ENV NODE_ENV=production \
  AIGC_DIRECTOR_CONTAINER=1 \
  AIGC_DIRECTOR_HOST=0.0.0.0 \
  AIGC_DIRECTOR_PORT=33100 \
  AIGC_DIRECTOR_DATA_DIR=/data \
  AIGC_DIRECTOR_STUDIO_DIR=/app/apps/studio/dist \
  AIGC_DIRECTOR_DEMO_ASSET_DIR=/app/resources/demo/xingque \
  AIGC_DIRECTOR_CREDENTIALS_FILE=/run/secrets/provider_credentials \
  TMPDIR=/tmp/aigc-director

USER node
EXPOSE 33100
HEALTHCHECK --interval=10s --timeout=3s --start-period=20s --retries=6 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:33100/api/v2/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
CMD ["node", "apps/server/dist/index.js"]
