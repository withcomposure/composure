# Shared metadata for workspace installs
FROM node:22-alpine AS workspace-meta
WORKDIR /app
COPY package.json package-lock.json* ./
COPY frontend/package.json frontend/
COPY backend/package.json backend/

# Frontend builder
FROM workspace-meta AS frontend-builder
RUN npm install --workspace=frontend --ignore-scripts
COPY frontend/ frontend/
RUN npm run build --workspace=frontend

# Backend builder
FROM workspace-meta AS backend-builder
RUN apk add --no-cache python3 make g++
RUN npm install --workspace=backend
COPY backend/ backend/
RUN npm run build --workspace=backend

# Shared runtime base for both deployment modes
FROM node:22-alpine AS runtime-base

RUN apk add --no-cache \
    tectonic \
    pandoc \
    git \
    && rm -rf /var/cache/apk/*

WORKDIR /app

COPY --from=backend-builder /app/backend/dist ./backend/dist
COPY --from=backend-builder /app/backend/package.json ./backend/
COPY --from=backend-builder /app/node_modules ./node_modules
COPY package.json ./
COPY templates ./templates

RUN mkdir -p /app/data
VOLUME /app/data

ENV NODE_ENV=production
ENV PORT=8080
ENV DATA_DIR=/app/data

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s \
  CMD wget -qO- http://localhost:8080/health || exit 1

CMD ["node", "backend/dist/server.js"]

# API-only target for split frontend deployments
FROM runtime-base AS api-only
ENV SERVE_FRONTEND=false

# Default all-in-one target for self-hosted deployments
FROM runtime-base AS all-in-one
COPY --from=frontend-builder /app/frontend/dist ./frontend/dist
ENV SERVE_FRONTEND=true
