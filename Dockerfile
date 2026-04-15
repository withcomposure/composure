# ─── Stage 1: Build frontend ───
FROM node:22-alpine AS frontend-build
WORKDIR /app
COPY package.json package-lock.json* ./
COPY frontend/package.json frontend/
RUN npm install --workspace=frontend --ignore-scripts
COPY frontend/ frontend/
RUN npm run build --workspace=frontend

# ─── Stage 2: Build backend ───
FROM node:22-alpine AS backend-build
WORKDIR /app
COPY package.json package-lock.json* ./
COPY backend/package.json backend/
RUN apk add --no-cache python3 make g++
RUN npm install --workspace=backend
COPY backend/ backend/
RUN npm run build --workspace=backend

# ─── Stage 3: Runtime ───
FROM node:22-alpine AS runtime

# Install tectonic (LaTeX) and pandoc
RUN apk add --no-cache \
    tectonic \
    pandoc \
    git \
    && rm -rf /var/cache/apk/*

WORKDIR /app

# Copy backend build + node_modules
COPY --from=backend-build /app/backend/dist ./backend/dist
COPY --from=backend-build /app/backend/package.json ./backend/
COPY --from=backend-build /app/node_modules ./node_modules
COPY package.json ./

# Copy frontend build
COPY --from=frontend-build /app/frontend/dist ./frontend/dist

# Copy baked-in project templates
COPY templates ./templates

# Serve the frontend statically from the Express server in production
# This is handled in server.ts via express.static

# Data directory
RUN mkdir -p /app/data
VOLUME /app/data

ENV NODE_ENV=production
ENV PORT=8080
ENV DATA_DIR=/app/data

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s \
  CMD wget -qO- http://localhost:8080/health || exit 1

CMD ["node", "backend/dist/server.js"]
