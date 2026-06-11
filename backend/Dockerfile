FROM node:24-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev --legacy-peer-deps
COPY tsconfig.json ./
COPY src/ ./src/
RUN npx tsc

FROM node:24-alpine AS runner
WORKDIR /app
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 appuser
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY package*.json ./
COPY --chown=appuser:nodejs .env.production .env
USER appuser
EXPOSE 5000
ENV NODE_ENV=production
ENV CLUSTER_ENABLED=true
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:5000/health || exit 1
CMD ["node", "dist/index.js"]
