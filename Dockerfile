FROM node:22-bookworm-slim@sha256:83f487e0a63425e5b4d146fb5e5be574bcbe1b7b843d3ebafdd95eaf7767a7e5 AS base
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
RUN groupmod -g 1001 node && usermod -u 1001 -g 1001 node && mkdir -p /data/files && chown node:node /data/files

FROM base AS dependencies
COPY package.json package-lock.json ./
RUN npm ci

FROM dependencies AS tools
COPY --chown=node:node . .
RUN chown node:node /app
USER node

FROM dependencies AS builder
COPY . .
RUN npm run build

FROM node:22-bookworm-slim@sha256:83f487e0a63425e5b4d146fb5e5be574bcbe1b7b843d3ebafdd95eaf7767a7e5 AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=3000
RUN groupmod -g 1001 node && usermod -u 1001 -g 1001 node \
  && apt-get update \
  && apt-get install -y --no-install-recommends util-linux tesseract-ocr tesseract-ocr-por poppler-utils \
  && rm -rf /var/lib/apt/lists/* \
  && mkdir -p /data/files \
  && chown 1001:1001 /data/files
COPY --from=builder --chown=node:node /app/public ./public
COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/.next/static ./.next/static
COPY --from=dependencies --chown=node:node /app/node_modules/postgres ./node_modules/postgres
COPY --from=dependencies --chown=node:node /app/node_modules/csv-parse ./node_modules/csv-parse
COPY --from=dependencies --chown=node:node /app/node_modules/yauzl ./node_modules/yauzl
COPY --from=dependencies --chown=node:node /app/node_modules/yazl ./node_modules/yazl
COPY --from=dependencies --chown=node:node /app/node_modules/pend ./node_modules/pend
COPY --from=dependencies --chown=node:node /app/node_modules/buffer-crc32 ./node_modules/buffer-crc32
COPY --from=builder --chown=node:node /app/scripts ./scripts
COPY --from=builder --chown=node:node /app/db/migrations ./db/migrations
RUN mkdir -p .next/cache && chown -R node:node .next && chmod 755 scripts/railway-entrypoint.sh scripts/railway-oneoff.sh
EXPOSE 3000
ENTRYPOINT ["/app/scripts/railway-entrypoint.sh"]
