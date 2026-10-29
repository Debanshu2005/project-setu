# ==============================================================================
# Project Setu - Production Cloud Simulation Dockerfile
# Multi-stage build: C++ compiler stage -> minimal Node.js runtime stage
# Compatible with Render Free, Fly.io, Railway, and local Docker runs.
# ==============================================================================

# ------------------------------------------------------------------------------
# Stage 1: Build & Test Native C++ Simulator Core
# ------------------------------------------------------------------------------
FROM debian:bookworm-slim AS builder

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    cmake \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /build

# Copy build manifest and sources
COPY CMakeLists.txt ./
COPY shared ./shared
COPY simulation ./simulation
COPY firmware ./firmware
COPY tests ./tests

# Configure native Release build
RUN cmake -B build -DCMAKE_BUILD_TYPE=Release

# Compile all targets (core, world, simulator, unit & integration tests)
RUN cmake --build build --config Release -j$(nproc)

# Execute full native test suite inside the build container
RUN ctest --test-dir build -C Release --output-on-failure

# ------------------------------------------------------------------------------
# Stage 2: Production Runtime Image (Minimal Node.js + Compiled Simulator)
# ------------------------------------------------------------------------------
FROM node:20-bookworm-slim AS runner

WORKDIR /app

# Ensure required C++ standard library runtime is present
RUN apt-get update && apt-get install -y --no-install-recommends \
    libstdc++6 \
    libc6 \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Copy native C++ executable from builder stage
COPY --from=builder /build/build/setu_sim /app/build/setu_sim
RUN chmod +x /app/build/setu_sim

# Copy package manifests and application code
COPY package.json ./
COPY dashboard ./dashboard
COPY scenarios ./scenarios

# Create directory for runtime traces
RUN mkdir -p /app/scenarios/traces

# Environment configuration
ARG RENDER_GIT_COMMIT
ARG GIT_COMMIT
ARG BUILD_TIME

ENV RENDER_GIT_COMMIT=${RENDER_GIT_COMMIT}
ENV GIT_COMMIT=${GIT_COMMIT}
ENV BUILD_TIME=${BUILD_TIME}
ENV NODE_ENV=production
ENV PORT=3000
ENV SETU_SIM_PATH=/app/build/setu_sim

# Expose web service port
EXPOSE 3000

# Docker healthcheck querying the real /health endpoint
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:${PORT}/health || exit 1

# Start the operations dashboard & simulation bridge server
CMD ["node", "dashboard/server.js"]
