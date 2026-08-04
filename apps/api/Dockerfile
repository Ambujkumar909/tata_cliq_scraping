# ── PriceLens API ─────────────────────────────────────────────
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev || npm install --omit=dev

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY src ./src
COPY scripts ./scripts
# Ship any pre-ingested data if present (catalog + comparisons)
COPY data ./data
EXPOSE 4010
# Healthcheck hits /api/health
HEALTHCHECK --interval=15s --timeout=5s --retries=5 \
  CMD node -e "require('http').get('http://localhost:'+(process.env.PORT||4010)+'/api/health',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"
CMD ["node", "src/server.mjs"]
