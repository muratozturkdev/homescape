# Stage 1: the web app. Uses the files in ./www when present (npm run build:app), else builds them from the repository.
FROM node:22-alpine AS web
ARG HOMESCAPE_REPO=https://github.com/muratozturkdev/homescape
ARG HOMESCAPE_REF=main
COPY . /files
RUN if [ -f /files/www/index.html ]; then \
      cp -r /files/www /out; \
    else \
      apk add --no-cache git \
      && git clone --depth 1 --branch "${HOMESCAPE_REF}" "${HOMESCAPE_REPO}" /src \
      && cd /src \
      && npm ci --no-audit --no-fund \
      && npm run build \
      && cp -r dist /out; \
    fi

# Stage 2: a small nginx that serves the files to Home Assistant's ingress
FROM ghcr.io/home-assistant/base:3.24
RUN apk add --no-cache nginx && mkdir -p /run/nginx
COPY nginx.conf /etc/nginx/http.d/default.conf
COPY --from=web /out/ /var/www/homescape/
CMD ["nginx", "-g", "daemon off;"]
