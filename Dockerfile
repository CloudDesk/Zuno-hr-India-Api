
# Multi-stage build for smaller final image
# Stage 1: Build stage
FROM node:20-slim AS builder

# Install build dependencies + Chromium + LibreOffice (used by other services)
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
    chromium \
    chromium-sandbox \
    libreoffice \
    python3 \
    make \
    g++ && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

# Tell Puppeteer to skip downloading bundled Chrome — use system Chromium instead
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

WORKDIR /app

# Copy package files first for better layer caching
COPY package*.json ./

# Install all dependencies (including devDependencies for build)
RUN npm ci

# Copy source code
COPY . .

# Build the application
RUN npm run build

# ─────────────────────────────────────────────────────────────
# Stage 2: Production stage
# ─────────────────────────────────────────────────────────────
FROM node:20-slim AS production

# Install Chromium + all required system libs for headless Chrome + LibreOffice (other services)
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
    chromium \
    chromium-sandbox \
    libreoffice \
    fonts-liberation \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libc6 \
    libcairo2 \
    libcups2 \
    libdbus-1-3 \
    libexpat1 \
    libfontconfig1 \
    libgbm1 \
    libgcc1 \
    libglib2.0-0 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libpango-1.0-0 \
    libpangocairo-1.0-0 \
    libstdc++6 \
    libx11-6 \
    libx11-xcb1 \
    libxcb1 \
    libxcomposite1 \
    libxcursor1 \
    libxdamage1 \
    libxext6 \
    libxfixes3 \
    libxi6 \
    libxrandr2 \
    libxrender1 \
    libxss1 \
    libxtst6 \
    ca-certificates \
    wget \
    xdg-utils && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

# Point Puppeteer at the system Chromium — no bundled download needed
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install only production dependencies (Puppeteer won't try to download Chrome)
RUN npm ci --only=production && \
    npm cache clean --force

# Copy built application from builder stage
COPY --from=builder /app/dist ./dist

# Copy templates directory (for runtime template access)
COPY --from=builder /app/templates ./templates

# Copy root-level template files (payslip templates, etc.)
COPY --from=builder /app/*.docx ./ 2>/dev/null || true

# Create uploads directory and non-root user for security
RUN mkdir -p /app/uploads && \
    groupadd -r appuser && useradd -r -g appuser appuser && \
    chown -R appuser:appuser /app

USER appuser

# Expose the port
EXPOSE 5800

# Start the application
CMD [ "node", "dist/local.js" ]