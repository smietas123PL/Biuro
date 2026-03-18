FROM node:20-alpine as build
WORKDIR /app

# Install pnpm
RUN npm install -g pnpm

# Copy everything (obeying .dockerignore which excludes node_modules)
COPY . .

# Install all dependencies for the workspace
RUN pnpm install

# Build the dashboard
RUN pnpm --filter @biuro/dashboard build

FROM nginx:alpine
COPY --from=build /app/packages/dashboard/dist /usr/share/nginx/html
COPY packages/dashboard/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
