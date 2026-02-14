FROM node:20-slim AS base

# Install OpenSSL for bcrypt native compilation
RUN apt-get update && apt-get install -y openssl python3 make g++ && rm -rf /var/lib/apt/lists/*
RUN corepack enable

WORKDIR /app

# Copy workspace config and lockfile
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./

# Copy server package.json for dependency resolution
COPY packages/server/package.json packages/server/

# Install server dependencies only
RUN pnpm install --frozen-lockfile --filter @gardoo/server

# Copy tsconfig files needed for build
COPY tsconfig.base.json ./
COPY packages/server/tsconfig.json packages/server/
COPY packages/server/src packages/server/src

# Build the server
RUN pnpm --filter @gardoo/server build

# --- Production stage ---
FROM node:20-slim AS production

RUN apt-get update && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*
RUN corepack enable

WORKDIR /app

# Copy workspace config
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages/server/package.json packages/server/

# Install production dependencies only
RUN pnpm install --frozen-lockfile --filter @gardoo/server --prod

# Copy built output from build stage
COPY --from=base /app/packages/server/dist packages/server/dist

EXPOSE 3000

CMD ["node", "packages/server/dist/index.js"]
