# Multi-stage build for Node.js backend + React frontend

# Stage 1: Build React frontend
FROM node:18-alpine AS frontend-builder
WORKDIR /app/client
COPY client/package*.json ./
RUN npm ci
COPY client/ ./
RUN npm run build

# Stage 2: Backend & serve frontend
FROM node:18-alpine
WORKDIR /app

# Install dumb-init for proper signal handling
RUN apk add --no-cache dumb-init

# Copy server files
COPY server/ ./server/
COPY package*.json ./

# Copy built frontend from stage 1
COPY --from=frontend-builder /app/client/dist ./client/dist

# Install production dependencies
RUN npm ci --omit=dev

# Expose port
EXPOSE 3000

# Use dumb-init to handle signals properly
ENTRYPOINT ["dumb-init", "--"]
CMD ["npm", "start"]
