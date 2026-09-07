FROM node:22-alpine AS base
RUN corepack enable && corepack prepare pnpm@11.13.1 --activate
# Toolchain for native modules (better-sqlite3) when no musl prebuild is available
RUN apk add --no-cache python3 make g++
WORKDIR /app

FROM base AS build
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm build
# The server bundles @bookdock/shared, so standalone deploy avoids requiring
# injected workspace packages solely for the production layout step.
RUN pnpm --filter @bookdock/server deploy --legacy --prod /out/server

FROM node:22-alpine AS runtime
WORKDIR /app
COPY --from=build /out/server ./apps/server
COPY --from=build /app/apps/web/dist ./apps/web/dist
RUN mkdir -p /data
ENV NODE_ENV=production
ENV DATA_DIR=/data
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 CMD node -e "fetch('http://127.0.0.1:3000/api/v1/health').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"
CMD ["node", "apps/server/dist/index.js"]
