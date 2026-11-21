# BECBarrier authoritative API (Express/TypeScript).
FROM node:22-bookworm-slim AS build
WORKDIR /repo
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY tsconfig.base.json ./
COPY packages ./packages
COPY apps/api ./apps/api
RUN npm run build:packages && cd apps/api && npx tsc -b

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /srv
COPY --from=build /repo/apps/api/dist ./dist
COPY --from=build /repo/apps/api/package.json ./
COPY --from=build /repo/node_modules ./node_modules
RUN useradd --system --uid 10001 --no-create-home bbapi
USER bbapi
EXPOSE 4000
HEALTHCHECK --interval=15s --timeout=3s --retries=5 CMD node -e "fetch('http://127.0.0.1:4000/api/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/main.js"]
