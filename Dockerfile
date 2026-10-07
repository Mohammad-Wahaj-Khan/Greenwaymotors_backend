FROM node:24-alpine AS build

WORKDIR /app
ENV CI=true
RUN corepack enable

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

COPY . ./
RUN pnpm build && pnpm prune --prod

FROM node:24-alpine AS runtime

WORKDIR /app
ENV NODE_ENV=production
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/openapi/openapi.yaml ./openapi/openapi.yaml
COPY --from=build --chown=node:node /app/package.json ./package.json
USER node
EXPOSE 4000
CMD ["node", "dist/server.js"]
