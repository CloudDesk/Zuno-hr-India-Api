
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


# Copy package files first for better layer caching
COPY package*.json ./

# Install all dependencies (including devDependencies for build)
RUN npm ci

# Copy the rest of your application's source code
COPY . .



# Build the application
RUN npm run build

# Collect any root-level .docx templates into a staging dir.
# A .keep placeholder guarantees the dir always exists so COPY never fails.
RUN mkdir -p /app/_docx_stage && \
    find /app -maxdepth 1 -name "*.docx" -exec cp {} /app/_docx_stage/ \; 2>/dev/null ; \
    touch /app/_docx_stage/.keep

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

# Set the working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install only production dependencies
RUN npm ci --only=production && \
    npm cache clean --force

# Copy built application and templates from builder
COPY --from=builder /app/dist ./dist

# Copy templates directory (for runtime template access)
COPY --from=builder /app/templates ./templates

# Copy .docx templates to /app root (collected safely in builder stage)
COPY --from=builder /app/_docx_stage/ ./

# Create uploads directory and non-root user for security
RUN mkdir -p /app/uploads && \
    groupadd -r appuser && useradd -r -g appuser appuser && \
    chown -R appuser:appuser /app

USER appuser

# Expose the port
EXPOSE 5800

# Start the application
CMD [ "node", "dist/local.js" ]