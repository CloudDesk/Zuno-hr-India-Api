
# Multi-stage build for smaller final image
# ─────────────────────────────────────────
# Stage 1: Build stage
# ─────────────────────────────────────────
FROM node:20-slim AS builder

# Install build tools + chromium + libreoffice (apt handles all transitive deps)
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
    chromium \
    libreoffice \
    python3 \
    make \
    g++ && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

# Tell Puppeteer to use the system chromium — skip bundled Chrome download
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

# ─────────────────────────────────────────
# Stage 2: Production stage
# ─────────────────────────────────────────
FROM node:20-slim AS production

# Only two packages needed — apt pulls all required libs automatically
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
    chromium \
    libreoffice && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

# Point Puppeteer at the system chromium binary
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production && \
    npm cache clean --force

# Copy built application and templates from builder
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/templates ./templates

# Copy any .docx templates at root level (FNF and similar — only if they exist)
# Using a RUN+cp so the build doesn't fail if no .docx files are present
RUN --mount=type=bind,from=builder,source=/app,target=/builder \
    find /builder -maxdepth 1 -name "*.docx" -exec cp {} /app/ \; || true

# Create uploads directory and non-root user for security
RUN mkdir -p /app/uploads && \
    groupadd -r appuser && useradd -r -g appuser appuser && \
    chown -R appuser:appuser /app

USER appuser

EXPOSE 5800
CMD [ "node", "dist/local.js" ]