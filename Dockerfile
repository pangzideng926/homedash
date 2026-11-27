# syntax=docker/dockerfile:1

FROM node:22-bookworm-slim AS builder

ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0

WORKDIR /app

# better-sqlite3 在缺少可用预编译二进制时需要原生编译工具链
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
  && rm -rf /var/lib/apt/lists/* \
  && corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY server/package.json ./server/
COPY web/package.json ./web/

RUN pnpm install --frozen-lockfile

COPY tsconfig.base.json ./
COPY server ./server
COPY web ./web

RUN pnpm build \
  && pnpm --filter server --prod --legacy deploy /prod/server

FROM node:22-bookworm-slim AS runner

WORKDIR /app

ENV NODE_ENV=production \
    PORT=3000 \
    HOST=0.0.0.0 \
    DATABASE_URL=file:/app/data/homedash.db \
    WEB_DIST_DIR=/app/web/dist

COPY --from=builder --chown=node:node /prod/server/package.json ./server/package.json
COPY --from=builder --chown=node:node /prod/server/node_modules ./server/node_modules
COPY --from=builder --chown=node:node /app/server/dist ./server/dist
COPY --from=builder --chown=node:node /app/server/drizzle ./server/drizzle
COPY --from=builder --chown=node:node /app/web/dist ./web/dist

RUN mkdir -p /app/data && chown -R node:node /app/data

EXPOSE 3000

VOLUME ["/app/data"]

USER node

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:' + (process.env.PORT || 3000) + '/api/health').then((r) => { if (!r.ok) process.exit(1); }).catch(() => process.exit(1))"]

CMD ["node", "server/dist/index.js"]
