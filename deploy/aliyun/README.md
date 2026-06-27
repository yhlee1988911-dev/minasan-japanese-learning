# Minasan on Alibaba Cloud ECS

This deployment mode is intentionally separated from Cloudflare.

- Cloudflare keeps using Worker + D1.
- Alibaba Cloud ECS uses Node.js + an independent SQLite file.
- User accounts, sessions, device records, mastered words, mistakes, and lesson progress are not shared between the two deployments.

## Server Requirements

- Ubuntu 22.04 or newer is recommended.
- Node.js 22 LTS or newer.
- Nginx.
- A Linux user named `minasan`.
- Application directory: `/opt/minasan`.
- Database directory: `/var/lib/minasan`.

## First Setup

```bash
sudo useradd --system --create-home --shell /usr/sbin/nologin minasan
sudo mkdir -p /opt/minasan /var/lib/minasan
sudo chown -R minasan:minasan /opt/minasan /var/lib/minasan
```

Clone the repository into `/opt/minasan`, then run:

```bash
npm ci
npm run build
sudo cp deploy/aliyun/minasan.service /etc/systemd/system/minasan.service
sudo systemctl daemon-reload
sudo systemctl enable --now minasan
```

Edit `/etc/systemd/system/minasan.service` before starting production:

- Set `PUBLIC_ORIGIN` to the Alibaba Cloud domain or public IP.
- Keep `MINASAN_SQLITE_PATH=/var/lib/minasan/minasan.sqlite` for independent data.

For Nginx:

```bash
sudo cp deploy/aliyun/nginx.conf /etc/nginx/sites-available/minasan
sudo ln -s /etc/nginx/sites-available/minasan /etc/nginx/sites-enabled/minasan
sudo nginx -t
sudo systemctl reload nginx
```

Edit `server_name example.com` before enabling public traffic.

## Local Verification

```bash
npm run build
MINASAN_SQLITE_PATH=.aliyun/local.sqlite PORT=8788 npm run server:start
```

Open:

```text
http://127.0.0.1:8788
```

The first boot applies the existing SQL migrations into the independent SQLite file and creates the `root` user on first login. The root password remains:

```text
rootminasan1982
```

## GitHub Actions Secrets

The optional workflow `.github/workflows/deploy-aliyun.yml` uses these secrets:

- `ALIYUN_HOST`
- `ALIYUN_PORT`
- `ALIYUN_USER`
- `ALIYUN_SSH_KEY`
- `ALIYUN_APP_DIR`, optional, defaults to `/opt/minasan`
- `ALIYUN_PUBLIC_ORIGIN`, optional, for the server environment

The workflow only deploys the Node/SQLite ECS version. It does not run `wrangler deploy` and does not modify Cloudflare D1.
