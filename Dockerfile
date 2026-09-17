# ---------- STAGE 1: builder ----------
FROM node:24-alpine AS builder
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml ./
# Instala prod deps. --shamefully-hoist aplana node_modules (sin enlaces al store),
# para que se puedan COPIAR limpiamente a la siguiente stage.
RUN pnpm install --prod --frozen-lockfile --shamefully-hoist

# ---------- STAGE 2: runtime ----------
FROM node:24-alpine AS runtime
WORKDIR /app
# Copia SOLO node_modules ya instalado desde el builder (sin pnpm, sin corepack)
COPY --from=builder --chown=node:node /app/node_modules ./node_modules
# Copia el código de la app
COPY --chown=node:node . .
EXPOSE 3000
USER node
CMD ["node", "src/server.js"]
