# The Nebotok server image: the Node server, the shared core and the built game, nothing else.
# Both stages use the same Node release as Volta pins in package.json, pinned by digest so a
# re-pushed tag can never change what we build on. Dependabot proposes digest updates weekly.
#
# Build:  docker build -t nebotok .      (CI builds linux/amd64 and linux/arm64)
# Run:    see compose.yaml (Mac mini) and compose.local.yaml (local test)

# The game build is plain JavaScript output, so it runs once on the build machine's own platform
# instead of under emulation for each target.
# node:26.13.0-trixie-slim
FROM --platform=$BUILDPLATFORM node:26.13.0-trixie-slim@sha256:e4db4c914bf8ad241bd24804fc25d272d89bad97e68cdc8a1414862790a02c39 AS build
WORKDIR /app
COPY .npmrc package.json package-lock.json ./
COPY packages/core/package.json packages/core/
COPY apps/server/package.json apps/server/
COPY apps/game/package.json apps/game/
RUN npm ci --ignore-scripts --no-audit --no-fund
COPY tsconfig.base.json ./
COPY content content
COPY packages/core packages/core
COPY apps/game apps/game
RUN npm run build

# node:26.13.0-trixie-slim
FROM node:26.13.0-trixie-slim@sha256:e4db4c914bf8ad241bd24804fc25d272d89bad97e68cdc8a1414862790a02c39 AS runtime
LABEL org.opencontainers.image.source="https://github.com/nazuje/nebotok" \
      org.opencontainers.image.description="Nebotok game server" \
      org.opencontainers.image.licenses="NOASSERTION"
ENV NODE_ENV=production
WORKDIR /app
# Every workspace manifest is needed for npm ci to accept the lockfile, but only the server's
# production dependencies are installed: no game libraries, no dev tools, no install scripts.
COPY .npmrc package.json package-lock.json ./
COPY packages/core/package.json packages/core/
COPY apps/server/package.json apps/server/
COPY apps/game/package.json apps/game/
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund --workspace @nebotok/server \
 && npm cache clean --force \
 && mkdir /data \
 && chown node:node /data
COPY packages/core/src packages/core/src
COPY apps/server/src apps/server/src
COPY content content
COPY --from=build /app/apps/game/dist apps/game/dist

# The app files stay owned by root, so the server cannot rewrite its own code even where the root
# filesystem is writable. Only /data (world saves) belongs to the node user.
USER node
ENV PORT=2567 \
    HOST=0.0.0.0 \
    DATA_DIR=/data
EXPOSE 2567
VOLUME ["/data"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:' + (process.env.PORT || 2567) + '/healthz').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
# Node runs the TypeScript directly. No npm at runtime: it would want to write logs under $HOME.
CMD ["node", "apps/server/src/index.ts"]
