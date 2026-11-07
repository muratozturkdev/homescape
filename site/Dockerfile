# The public demo site (homescape.muratozturk.dev): the app built in site mode (src/site.ts), served by nginx.
# Build from the repository root: docker build -f site/Dockerfile .
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build:site

FROM nginx:1.27-alpine
COPY site/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist-site /usr/share/nginx/html
EXPOSE 80
