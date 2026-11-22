ARG NODE_VERSION
FROM node:${NODE_VERSION}-alpine3.24 AS build
ARG APP_VERSION=development
ARG VITE_MEDIA_ORIGIN=https://media.stuhelper.com
WORKDIR /src
ENV LEFTHOOK=0
ENV VITE_APP_VERSION=${APP_VERSION}
RUN apk add --no-cache git
COPY . .
RUN node scripts/render-media-csp.mjs
RUN corepack enable && corepack install && pnpm install --frozen-lockfile && pnpm run setup && pnpm run build

FROM nginx:1.30.6-alpine3.24
ARG SOURCE_REVISION
ARG APP_VERSION
LABEL org.opencontainers.image.source="https://github.com/StuHelper/stuhelper-admin" \
      org.opencontainers.image.revision="${SOURCE_REVISION}" \
      org.opencontainers.image.version="${APP_VERSION}"
COPY --from=build /src/deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /src/apps/web-antd/dist /usr/share/nginx/html
RUN sed -i -e '/^\s*user\s/d' -e 's,/var/run/nginx.pid,/tmp/nginx.pid,' -e 's,/run/nginx.pid,/tmp/nginx.pid,' /etc/nginx/nginx.conf \
  && chown -R nginx:nginx /var/cache/nginx /var/log/nginx /etc/nginx/conf.d /usr/share/nginx/html
USER nginx
EXPOSE 8080
HEALTHCHECK --interval=10s --timeout=3s --retries=3 CMD wget -q -O /dev/null http://127.0.0.1:8080/healthz || exit 1
