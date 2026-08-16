# ── PriceLens API ─────────────────────────────────────────────
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev || npm install --omit=dev

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
# The PDF export needs a font carrying the rupee sign. PDF's built-in Helvetica
# has no glyph for U+20B9 and prints a blank box, which on a pricing document
# is worse than no export at all. Noto Sans carries it; the exporter falls back
# to "Rs." if this package is ever absent.
RUN apk add --no-cache font-noto

# ── Optional: browser for Ajio's PDP tier ─────────────────────
# Ajio's product-detail API only answers requests originating inside a real
# page context (see src/sources/ajio-session.mjs), and headless Chrome is
# refused outright — so the browser must run HEADED against a virtual display.
# Off by default: these packages add ~400MB, and the stack is fully functional
# without them (Ajio specs simply render "not available").
#
#   docker compose build --build-arg WITH_BROWSER=true api
ARG WITH_BROWSER=false
RUN if [ "$WITH_BROWSER" = "true" ]; then \
      apk add --no-cache chromium xvfb xvfb-run dbus ttf-freefont; \
    fi
ENV CHROME_PATH=/usr/bin/chromium-browser

COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY src ./src
COPY scripts ./scripts
COPY docker-entrypoint.sh ./
# Ship any pre-ingested data if present (catalog + comparisons)
COPY data ./data
RUN chmod +x docker-entrypoint.sh
EXPOSE 4010
# Healthcheck hits /api/health
HEALTHCHECK --interval=15s --timeout=5s --retries=5 \
  CMD node -e "require('http').get('http://localhost:'+(process.env.PORT||4010)+'/api/health',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"
ENTRYPOINT ["./docker-entrypoint.sh"]
CMD ["node", "src/server.mjs"]
