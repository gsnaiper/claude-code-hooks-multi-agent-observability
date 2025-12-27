# Server Dockerfile - Bun runtime (Debian for glibc/ONNX support)
FROM oven/bun:1.1-debian AS base
WORKDIR /app

# Production image
FROM base AS runner
ENV NODE_ENV=production

# Create app user and install wget for healthcheck
RUN groupadd --system --gid 1001 nodejs && \
    useradd --system --uid 1001 --gid nodejs bunjs && \
    apt-get update && apt-get install -y wget && \
    rm -rf /var/lib/apt/lists/*

# Copy package.json only (skip lockfile due to version mismatch)
COPY package.json ./

# Install dependencies
RUN bun install --production

# Copy source code
COPY --chown=bunjs:nodejs . .

# Create data directory for SQLite and LanceDB
RUN mkdir -p data && chown -R bunjs:nodejs data

USER bunjs

EXPOSE 4000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:4000/health || exit 1

CMD ["bun", "run", "src/index.ts"]
