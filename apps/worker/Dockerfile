# BECBarrier outbox worker — never holds financial authority.
FROM node:22-bookworm-slim AS build
WORKDIR /repo
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY tsconfig.base.json ./
COPY packages ./packages
COPY apps/worker ./apps/worker
RUN npm run build:packages && cd apps/worker && npx tsc -b

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /srv
COPY --from=build /repo/apps/worker/dist ./dist
COPY --from=build /repo/apps/worker/package.json ./
COPY --from=build /repo/node_modules ./node_modules
RUN useradd --system --uid 10002 --no-create-home bbworker
USER bbworker
CMD ["node", "dist/main.js"]
