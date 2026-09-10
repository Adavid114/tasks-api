FROM node:24-slim

WORKDIR /app

RUN corepack enable

# Copy manifests with ownership set to the node user from the start.
COPY --chown=node:node package.json pnpm-lock.yaml ./
RUN pnpm install --prod --frozen-lockfile

# Copy the rest, also owned by node.
COPY --chown=node:node . .

EXPOSE 3000

USER node

CMD ["node", "src/server.js"]
ESTA_LINEA_NO_EXISTE_Y_ROMPE_EL_BUILD
