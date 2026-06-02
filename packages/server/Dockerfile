# syntax=docker/dockerfile:1.7

FROM node:22-slim AS base

WORKDIR /app

ENV PNPM_HOME="/root/.local/share/pnpm"
ENV PATH="$PNPM_HOME:$PATH"

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates openssl \
  && rm -rf /var/lib/apt/lists/* \
  && corepack enable

FROM base AS deps

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/package.json
COPY packages/server/package.json packages/server/package.json

RUN --mount=type=cache,id=tengyu-aipod-pnpm-store,target=/root/.local/share/pnpm/store \
  pnpm install --frozen-lockfile

FROM deps AS builder

ENV DATABASE_URL="postgresql://build:build@localhost:5432/tengyu_aipod"
ENV NEXT_PUBLIC_APP_NAME="腾域 aipod"

COPY packages/shared packages/shared
COPY packages/server packages/server

RUN pnpm -F @tengyu-aipod/server prisma:generate
RUN pnpm -F @tengyu-aipod/server build

FROM base AS runner

ENV NODE_ENV="production"
ENV NEXT_TELEMETRY_DISABLED="1"

COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/pnpm-lock.yaml ./pnpm-lock.yaml
COPY --from=builder /app/pnpm-workspace.yaml ./pnpm-workspace.yaml
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages/shared ./packages/shared
COPY --from=builder /app/packages/server ./packages/server

EXPOSE 3100

CMD ["pnpm", "-F", "@tengyu-aipod/server", "start"]
