FROM node:24-alpine AS builder
WORKDIR /app

COPY package*.json tsconfig.json ./
RUN npm install --legacy-peer-deps

COPY src/ ./src/
RUN npx tsc

# ── Runtime stage ──────────────────────────────────────────────────────────────
FROM node:24-alpine AS runner
WORKDIR /app

RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 appuser

COPY package*.json ./
RUN npm install --omit=dev --legacy-peer-deps

COPY --from=builder /app/dist ./dist

RUN mkdir -p logs && chown appuser:nodejs logs

USER appuser
EXPOSE 5000

ENV NODE_ENV=production
# Cluster mode OFF on Railway — single container, PORT is managed by Railway
ENV CLUSTER_ENABLED=false

HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=5 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:5000/health || exit 1

CMD ["node", "dist/index.js"]
