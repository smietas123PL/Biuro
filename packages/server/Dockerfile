FROM node:20-alpine as build
WORKDIR /app

# Install pnpm
RUN npm install -g pnpm

# Copy everything
COPY . .

# Install dependencies
RUN pnpm install

# Build the server and worker
RUN pnpm --filter @biuro/server build

# Runtime stage
FROM node:20-alpine
WORKDIR /app
RUN npm install -g pnpm
COPY --from=build /app /app

EXPOSE 3100
# Run the server from the correct directory
CMD ["pnpm", "--filter", "@biuro/server", "start"]
