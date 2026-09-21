# ---------- STAGE 1: builder ----------
FROM node:24-alpine AS builder
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml ./
# Install prod deps. --shamefully-hoist flattens node_modules (no links to the
# store), so it can be COPIED cleanly into the next stage.
RUN pnpm install --prod --frozen-lockfile --shamefully-hoist

# ---------- STAGE 2: runtime ----------
FROM node:24-alpine AS runtime
WORKDIR /app
# Remove package managers: at runtime the app runs node directly and never needs
# npm/npx/corepack. This drops the CVEs they carry and shrinks the attack surface.
RUN rm -rf /usr/local/lib/node_modules/npm \
           /usr/local/bin/npm \
           /usr/local/bin/npx \
           /usr/local/lib/node_modules/corepack \
           /usr/local/bin/corepack
# Copy ONLY the already-installed node_modules from the builder (no pnpm, no corepack)
COPY --from=builder --chown=node:node /app/node_modules ./node_modules
# Copy the application code
COPY --chown=node:node . .
EXPOSE 3000
USER node
CMD ["node", "src/server.js"]
