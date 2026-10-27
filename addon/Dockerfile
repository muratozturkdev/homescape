ARG BUILD_FROM

# Stage 1: the web app. Uses the files in ./www when present (npm run build:addon), else builds them from the repository.
FROM node:22-alpine AS app
ARG HOMESCAPE_REPO
ARG HOMESCAPE_REF
COPY . /addon
RUN if [ -f /addon/www/index.html ]; then \
      cp -r /addon/www /out; \
    else \
      apk add --no-cache git \
      && git clone --depth 1 --branch "${HOMESCAPE_REF}" "${HOMESCAPE_REPO}" /src \
      && cd /src \
      && npm ci --no-audit --no-fund \
      && npm run build \
      && cp -r dist /out; \
    fi

# Stage 2: a small nginx that serves the files to Home Assistant's ingress
FROM ${BUILD_FROM}
RUN apk add --no-cache nginx && mkdir -p /run/nginx
COPY nginx.conf /etc/nginx/http.d/default.conf
COPY --from=app /out/ /var/www/homescape/
CMD ["nginx", "-g", "daemon off;"]
