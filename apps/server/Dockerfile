# Server Dockerfile - Bun runtime
FROM oven/bun:1.1-alpine AS base
WORKDIR /app

# Install dependencies
FROM base AS deps
COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile --production

# Build stage (if needed for TypeScript)
FROM base AS builder
COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile
COPY . .
# TypeScript check (optional)
RUN bun run typecheck 2>/dev/null || true

# Production image
FROM base AS runner
ENV NODE_ENV=production

# Create app user
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 bunjs

# Copy dependencies
COPY --from=deps /app/node_modules ./node_modules

# Copy source code
COPY --chown=bunjs:nodejs . .

# Create data directory for SQLite and LanceDB
RUN mkdir -p data && chown -R bunjs:nodejs data

USER bunjs

EXPOSE 4000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:4000/health || exit 1

CMD ["bun", "run", "src/index.ts"]
