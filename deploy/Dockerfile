FROM node:24.18.0-bookworm-slim AS build
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@11.7.0 --activate
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/api/package.json ./apps/api/package.json
COPY apps/market-engine/package.json ./apps/market-engine/package.json
COPY apps/web/package.json ./apps/web/package.json
COPY apps/worker/package.json ./apps/worker/package.json
COPY packages/config/package.json ./packages/config/package.json
COPY packages/database/package.json ./packages/database/package.json
COPY packages/domain/package.json ./packages/domain/package.json
COPY packages/market-data/package.json ./packages/market-data/package.json
COPY packages/shared/package.json ./packages/shared/package.json
COPY packages/ui/package.json ./packages/ui/package.json
RUN pnpm install --frozen-lockfile
COPY apps ./apps
COPY packages ./packages
COPY server ./server
COPY src ./src
COPY test ./test
COPY index.html vite.config.js ./
RUN pnpm --workspace-concurrency=1 --filter "./packages/**" build \
 && pnpm --workspace-concurrency=1 --recursive --if-present typecheck \
 && pnpm --workspace-concurrency=1 --recursive --if-present build
COPY scripts ./scripts
COPY docs ./docs

FROM node:24.18.0-bookworm-slim AS production
ENV NODE_ENV=production
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@11.7.0 --activate
COPY --from=build /app /app
USER node
CMD ["pnpm", "--filter", "@market-dominion/api", "start"]
