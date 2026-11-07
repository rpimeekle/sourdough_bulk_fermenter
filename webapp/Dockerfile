# Bulk Ferment Timer: static web app served by unprivileged nginx.
# Build from the repository root or from webapp/:
#   docker build -t sourdough-webapp webapp/
FROM nginxinc/nginx-unprivileged:1.27-alpine

LABEL org.opencontainers.image.title="Bulk Ferment Timer" \
      org.opencontainers.image.description="Self-hosted sourdough bulk fermentation calculator with manual temperature input"

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY public/ /usr/share/nginx/html/

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:8080/healthz || exit 1
