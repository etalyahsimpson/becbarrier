# BECBarrier web tier (Next.js standalone output).
FROM node:22-bookworm-slim AS build
WORKDIR /repo
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY tsconfig.base.json ./
COPY packages ./packages
COPY apps/web ./apps/web
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build:packages && cd apps/web && npx next build

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
WORKDIR /srv
COPY --from=build /repo/apps/web/.next/standalone ./
COPY --from=build /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=build /repo/apps/web/public ./apps/web/public
RUN useradd --system --uid 10003 --no-create-home bbweb
USER bbweb
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
