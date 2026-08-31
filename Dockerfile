# syntax=docker/dockerfile:1.7
FROM node:22-bookworm-slim@sha256:83f487e0a63425e5b4d146fb5e5be574bcbe1b7b843d3ebafdd95eaf7767a7e5 AS base
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

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
ENV NODE_ENV=production     NEXT_TELEMETRY_DISABLED=1     HOSTNAME=0.0.0.0     PORT=3000
RUN groupmod -g 1001 node && usermod -u 1001 -g 1001 node
COPY --from=builder --chown=node:node /app/public ./public
COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/.next/static ./.next/static
RUN mkdir -p .next/cache && chown -R node:node .next
USER node
EXPOSE 3000
CMD ["node", "server.js"]
