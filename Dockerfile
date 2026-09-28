FROM node:24-alpine3.24 AS build

WORKDIR /app
RUN corepack enable && corepack prepare pnpm@11.19.0 --activate

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/contracts/package.json packages/contracts/package.json
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm build && pnpm store prune

FROM node:24-alpine3.24 AS runtime

WORKDIR /app
RUN apk add --no-cache postgresql17-client su-exec \
    && npm install --global pnpm@11.19.0

COPY --from=build /app /app
COPY scripts/container-entrypoint.sh /usr/local/bin/gn-planer-entrypoint
RUN chmod 0755 /usr/local/bin/gn-planer-entrypoint \
    && mkdir -p /app/data/Sicherungen \
    && chown -R node:node /app/data

EXPOSE 3001
ENTRYPOINT ["/usr/local/bin/gn-planer-entrypoint"]
