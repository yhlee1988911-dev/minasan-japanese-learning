#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/minasan}"
DATA_DIR="${DATA_DIR:-/var/lib/minasan}"
SERVICE_USER="${SERVICE_USER:-minasan}"

if ! id "$SERVICE_USER" >/dev/null 2>&1; then
  useradd --system --create-home --shell /usr/sbin/nologin "$SERVICE_USER"
fi

mkdir -p "$APP_DIR" "$DATA_DIR"
chown -R "$SERVICE_USER:$SERVICE_USER" "$APP_DIR" "$DATA_DIR"

if command -v apt-get >/dev/null 2>&1; then
  apt-get update
  apt-get install -y ca-certificates curl git nginx
fi

if ! command -v node >/dev/null 2>&1; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi

echo "Bootstrap complete."
echo "App dir: $APP_DIR"
echo "Data dir: $DATA_DIR"
echo "Service user: $SERVICE_USER"
