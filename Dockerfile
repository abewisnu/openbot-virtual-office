# syntax=docker/dockerfile:1

FROM node:22-alpine AS builder
WORKDIR /app

# Native build toolchain for better-sqlite3 on musl (discarded in runtime stage)
RUN apk add --no-cache python3 make g++

COPY package.json ./
RUN npm install --no-audit --no-fund

COPY index.html tsconfig.json tsconfig.node.json vite.config.ts vite-plugin-openbot.ts server.ts ./
COPY src ./src
COPY public ./public

ARG VITE_OFFICE_POLL_MS=
ENV VITE_OFFICE_POLL_MS=${VITE_OFFICE_POLL_MS}

RUN npm run build && \
  ./node_modules/.bin/esbuild server.ts \
    --bundle \
    --platform=node \
    --target=node22 \
    --format=esm \
    --minify \
    --external:better-sqlite3 \
    --outfile=dist-server/server.mjs

# Keep only the minimal runtime files needed by better-sqlite3 (drops ~25MB of C++ source/objects and 78MB+ frontend deps)
RUN mkdir -p /app/runtime_modules/better-sqlite3 && \
  cp node_modules/better-sqlite3/package.json /app/runtime_modules/better-sqlite3/ && \
  cp -r node_modules/better-sqlite3/lib /app/runtime_modules/better-sqlite3/ && \
  if [ -f node_modules/better-sqlite3/build/Release/better_sqlite3.node ]; then \
    mkdir -p /app/runtime_modules/better-sqlite3/build/Release && \
    cp node_modules/better-sqlite3/build/Release/better_sqlite3.node /app/runtime_modules/better-sqlite3/build/Release/; \
  fi && \
  if ls node_modules/better-sqlite3/prebuilds/linuxmusl-*.node >/dev/null 2>&1; then \
    mkdir -p /app/runtime_modules/better-sqlite3/prebuilds && \
    cp node_modules/better-sqlite3/prebuilds/linuxmusl-*.node /app/runtime_modules/better-sqlite3/prebuilds/; \
  fi


FROM node:22-alpine AS runner
WORKDIR /app

# Remove package managers not needed at runtime to keep the final image compact
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack /opt/yarn*

ENV NODE_ENV=production \
    PORT=3000

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/dist-server/server.mjs ./dist-server/server.mjs
COPY --from=builder /app/runtime_modules/better-sqlite3 ./node_modules/better-sqlite3

RUN chown -R node:node /app
USER node

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 3000) + '/healthz').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "dist-server/server.mjs"]
