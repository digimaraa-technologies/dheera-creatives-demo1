# Production Deployment Guide

Approved architecture:

| Surface | URL |
|---|---|
| Public website | `https://dheera.digimaraa.in/` |
| Admin dashboard | `https://dheera.digimaraa.in/admin` |
| Backend API | `https://dheera.digimaraa.in/api` |
| Uploaded images | `https://dheera.digimaraa.in/uploads/` |

One origin, one NestJS process, one nginx TLS terminator. Keeping the admin and
the API on the same origin keeps session cookies first-party and avoids
cross-site CSRF complications.

> **Status:** these files prepare the deployment; they do not configure a real
> server. DNS, the host, nginx, the TLS certificate, firewall rules and backups
> are **not** installed or verified by this repository. Treat every command
> marked ⚠️ or ⛔ below as an operator action to run against a verified target.

## 1. Prerequisites

- Ubuntu 24.04 LTS (or a comparable Linux distribution) with `systemd`.
- Node.js **20.11 or newer** (tested with Node 24) and npm.
- PostgreSQL **15 or newer**, reachable from the app host.
- nginx **1.24 or newer**.
- Certbot (or another ACME client) for HTTPS.
- A DNS `A`/`AAAA` record for `dheera.digimaraa.in` pointing at the server.
- A dedicated non-root Linux user, for example `dheera`.
- Outbound HTTPS access for npm and Let's Encrypt.

Check versions before building:

```bash
node -v
npm -v
psql --version
nginx -v
```

## 2. Release layout

Use releases plus a `current` symlink so rollback is a symlink switch:

```text
/opt/dheera-creatives/
├── releases/2026-11-17/
├── current -> releases/2026-11-17
└── ...
/etc/dheera-creatives/app.env          # production environment, mode 0600
/var/lib/dheera/uploads/               # persistent uploads
/var/backups/dheera/                   # database + upload snapshots
```

`current/` must contain `dist/`, `public/`, `admin/dist/`, `prisma/`,
`package.json` and `node_modules/`. The server resolves `public/` relative to
`dist/`, so running `node dist/main.js` from `current/` is enough.

## 3. Environment checklist

Create `/etc/dheera-creatives/app.env` (never commit it; mode `0600`, owned by
the service user). Safe examples only — replace every placeholder on the
server and keep the real values out of tickets, chat and Git.

| Variable | Required | Safe example | Purpose |
|---|---|---|---|
| `NODE_ENV` | yes | `production` | Enables Secure cookies, HSTS and production validation |
| `PORT` | no | `3000` | NestJS listen port behind nginx |
| `BIND_HOST` | **production** | `127.0.0.1` | Interface to bind; keep it off the public network |
| `TRUST_PROXY` | **production** | `1` | Proxy hops Express trusts for real client IPs |
| `DATABASE_URL` | yes | `postgresql://dheera_app:<password>@127.0.0.1:5432/dheera_creatives_db?schema=public` | Prisma/PostgreSQL connection |
| `ADMIN_FRONTEND_ORIGIN` | yes | `https://dheera.digimaraa.in` | CORS and login `Origin` allowlist; HTTPS required |
| `SESSION_TTL_HOURS` | no | `8` | Absolute admin session lifetime (1–720) |
| `SESSION_IDLE_TTL_MINUTES` | no | `30` | Idle sign-out (1–720) |
| `UPLOAD_DIR` | no | `/var/lib/dheera/uploads` | Persistent image directory |
| `ADMIN_USERNAME` | seed only | `admin` | Used by `npm run db:seed`, not at runtime |
| `ADMIN_EMAIL` | seed only | `admin@example.com` | Used by `npm run db:seed`, not at runtime |
| `ADMIN_PASSWORD` | seed only | `<12+ chars, <=72 UTF-8 bytes>` | Never commit; never print |
| `VITE_API_BASE_URL` | no | *(empty)* | Leave empty for the same-origin admin build |

Production startup refuses to run when:

- `DATABASE_URL` is missing or is not a `postgresql://` / `postgres://` URL.
- `TRUST_PROXY` is unset, or is `true` (only a hop count `0–10` is allowed).
- `BIND_HOST` is unset or contains unsafe characters.
- `ADMIN_FRONTEND_ORIGIN` is empty or contains a non-`https://` origin.
- `PORT` or a session setting is outside its allowed range.

These checks live in `src/config/env.validation.ts` and are covered by tests.
Set `TRUST_PROXY=2` only when both Cloudflare (or another CDN) **and** nginx are
in front; otherwise keep `1`. Never use `TRUST_PROXY=true`: clients could spoof
`X-Forwarded-For` and bypass rate limits.

### Database URL notes

- Use a dedicated, non-superuser role.
- Keep PostgreSQL on loopback or a private interface.
- For a remote database add `sslmode=require`; prefer
  `sslmode=verify-full` with the provider CA when available.
- The password must be URL-safe or percent-encoded.

## 4. Build

✅ Safe to run in the release directory; writes only build output.

```bash
# Extract or clone the release, then:
npm ci
npm run build

cd admin
npm ci
npm run build
cd ..
```

Do not build with the Vite dev server in production. `admin/dist` is generated
by `vite build` and served by NestJS at `/admin`; production never needs
`npm run dev`.

Verify the build artefacts exist:

```bash
test -f dist/main.js
test -f admin/dist/index.html
test -f public/index.html
```

## 5. PostgreSQL readiness

### Host and port

- Same host: `127.0.0.1:5432`.
- Separate host: the database's **private** address and port, allowed only from
  the app host.
- Never expose `5432` to `0.0.0.0/0` or the public internet.

### Application role

The app role needs to connect and read/write catalogue data. Prisma
`migrate deploy` also needs `CREATE` on the application schema (or ownership of
the schema/tables). A single dedicated role that owns the app schema is the
simplest safe setup:

```sql
-- Template only. Run as a PostgreSQL administrator after verifying names.
CREATE ROLE dheera_app LOGIN PASSWORD '<strong-password>';
CREATE DATABASE dheera_creatives_db OWNER dheera_app;
REVOKE ALL ON DATABASE dheera_creatives_db FROM PUBLIC;
REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT CONNECT ON DATABASE dheera_creatives_db TO dheera_app;
GRANT USAGE, CREATE ON SCHEMA public TO dheera_app;
```

For an existing database, prefer granting the minimum additional privileges
over changing ownership blindly. Do not make the role a superuser and do not
grant `CREATEDB`/`CREATEROLE`.

### Connection security

- `postgresql.conf`: `listen_addresses = 'localhost'` (or the private address),
  `ssl = on` for remote connections.
- `pg_hba.conf`: `scram-sha-256` for the app role; no `trust` for network
  connections.
- Firewall: allow `5432` only from the app host.
- Verify with `pg_isready -h <host> -p 5432 -d dheera_creatives_db`.

### Migrations

Migrations are **forward-only**. Never run `prisma migrate reset`,
`prisma db push --force-reset`, `DROP DATABASE` or `TRUNCATE` against a database
with real data.

✅ Read-only status check:

```bash
npx prisma validate
npx prisma migrate status
```

⚠️ Take a backup first, then apply pending migrations:

```bash
npm run db:migrate       # prisma migrate deploy
npx prisma generate      # usually already run by postinstall
npx prisma migrate status
```

Restart the app only after the migration reports success.

## 6. Database backup and restore

### Backup

✅ Safe and non-destructive. Run as the service user with the environment
loaded from the protected env file:

```bash
set -a
. /etc/dheera-creatives/app.env
set +a

install -d -m 0750 /var/backups/dheera
pg_dump --format=custom --no-owner \
  --file="/var/backups/dheera/db-$(date +%F-%H%M).dump" \
  "$DATABASE_URL"
```

Verify the dump immediately (do not skip this):

```bash
pg_restore --list /var/backups/dheera/db-YYYY-MM-DD-HHMM.dump >/dev/null
```

A backup is not proven until a restore has been tested.

### Restore verification

⛔ Restores are destructive to the target database. Never restore over live
production on the first attempt. Restore into a **new scratch database**, check
counts, then promote only with explicit approval.

```bash
createdb -h 127.0.0.1 -U postgres dheera_restore_check
pg_restore --dbname=dheera_restore_check --no-owner \
  /var/backups/dheera/db-YYYY-MM-DD-HHMM.dump

psql -h 127.0.0.1 -U postgres -d dheera_restore_check \
  -c 'SELECT (SELECT count(*) FROM products) AS products,
             (SELECT count(*) FROM services) AS services,
             (SELECT count(*) FROM admins) AS admins;'

dropdb -h 127.0.0.1 -U postgres dheera_restore_check
```

Also run `npx prisma migrate status` against the restored database before
considering the backup valid.

### Retention

Keep at least daily backups for 14 days, weekly for 8 weeks, and one monthly
off-site copy. Encrypt off-site copies and restrict access. Monitor backup age;
a stale backup should alert.

## 7. Persistent uploads

Uploaded images live on the filesystem, never in PostgreSQL.

```bash
sudo install -d -o dheera -g dheera -m 0750 /var/lib/dheera/uploads
sudo install -d -o dheera -g dheera -m 0750 /var/lib/dheera/uploads/products
sudo install -d -o dheera -g dheera -m 0750 /var/lib/dheera/uploads/services
```

Set `UPLOAD_DIR=/var/lib/dheera/uploads`.

- The Node user needs `rwx` on the upload root and subdirectories and `rw` on
  files. `0750` directories and `0640` files are a safe default.
- If the directory is missing, the app creates it recursively at startup.
- If the parent is unwritable, startup fails when the directory is created; if
  the directory exists but writes fail later, uploads return a server error.
- Existing images are served at `/uploads/...` by NestJS with a 7-day immutable
  cache, `X-Content-Type-Options: nosniff` and a restrictive CSP. Do not expose
  a directory listing.
- `uploads/` is git-ignored; it must be part of server backups.

### Uploads backup

✅ Safe:

```bash
tar --create --gzip \
  --file="/var/backups/dheera/uploads-$(date +%F).tar.gz" \
  -C /var/lib/dheera uploads

tar --list --file="/var/backups/dheera/uploads-YYYY-MM-DD.tar.gz" >/dev/null
sha256sum /var/backups/dheera/uploads-YYYY-MM-DD.tar.gz
```

Back up the database and uploads as one logical pair. To verify a restore,
extract to a scratch directory and compare file hashes; never delete or move the
live uploads to test a backup.

## 8. Application process manager

Use **systemd**, not PM2, on a standard Linux host. It supervises the process,
restarts on failure, captures stdout/stderr in journald and enables hardening.
The template is `deploy/systemd/dheera-creatives.service`.

⚠️ Install it on the server:

```bash
sudo cp deploy/systemd/dheera-creatives.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now dheera-creatives
sudo systemctl status dheera-creatives
```

The unit expects:

- code at `/opt/dheera-creatives/current`
- env file at `/etc/dheera-creatives/app.env`
- uploads at `/var/lib/dheera/uploads`
- Node at `/usr/bin/node`

Adjust `User`, `Group`, `ExecStart`, `WorkingDirectory` and `ReadWritePaths` if
the server layout differs. Changes to the unit require `daemon-reload` and a
restart.

Restart behaviour: `Restart=on-failure`, `RestartSec=5s`, with a start limit of
5 failures per 60 seconds to avoid restart loops.

## 9. Nginx and HTTPS

Files:

- `deploy/nginx/dheera.digimaraa.in.conf`
- `deploy/nginx/dheera-proxy.conf`

Status: **not installed or enabled by this repository.**

⚠️ Install after DNS points at the server:

```bash
sudo apt update && sudo apt install -y nginx certbot python3-certbot-nginx

sudo mkdir -p /var/www/certbot
sudo cp deploy/nginx/dheera.digimaraa.in.conf \
        /etc/nginx/sites-available/dheera.digimaraa.in.conf
sudo cp deploy/nginx/dheera-proxy.conf /etc/nginx/snippets/
sudo ln -s /etc/nginx/sites-available/dheera.digimaraa.in.conf \
           /etc/nginx/sites-enabled/dheera.digimaraa.in.conf

sudo nginx -t
sudo systemctl reload nginx
```

Obtain the certificate (this edits nginx or uses HTTP-01; review the diff):

```bash
sudo certbot --nginx -d dheera.digimaraa.in
sudo certbot renew --dry-run
```

The config expects Let's Encrypt paths under
`/etc/letsencrypt/live/dheera.digimaraa.in/`. If the certificate lives
elsewhere, update `ssl_certificate`, `ssl_certificate_key` and
`ssl_trusted_certificate` accordingly.

What the config does:

- Redirects HTTP to HTTPS, while keeping `/.well-known/acme-challenge/` on HTTP.
- Enables TLS 1.2/1.3, session caching, OCSP stapling and `server_tokens off`.
- Sets `client_max_body_size 6m` (5 MB upload plus multipart overhead).
- Proxies `/api/`, `/uploads/`, `/admin/` and `/` to `127.0.0.1:3000`.
- Redirects `/admin` to `/admin/`.
- Sends `Host`, `X-Real-IP`, `X-Forwarded-For`, `X-Forwarded-Proto`,
  `X-Forwarded-Host` and `X-Forwarded-Port`.
- Does **not** add WebSocket/Upgrade headers because the app has no WebSockets.
- Does **not** duplicate HSTS/CSP; NestJS sends them in production.

`TRUST_PROXY=1` must match the single nginx hop. If another proxy is added in
front, increase the hop count and make sure that proxy also sets
`X-Forwarded-For`.

## 10. Firewall, SSH and database exposure

Only nginx accepts public traffic.

| Port | Exposure | Notes |
|---|---|---|
| 22 | restricted | SSH; ideally allow only admin IPs |
| 80, 443 | public | nginx; 80 redirects to 443 |
| 3000 | loopback/private | NestJS; `BIND_HOST=127.0.0.1` on one host |
| 5432 | private | PostgreSQL; never public |

⚠️ Example UFW rules (verify before enabling; do not lock yourself out):

```bash
sudo ufw default deny incoming
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
sudo ufw status verbose
```

Verify rather than assume:

```bash
ss -ltnp | grep -E '3000|5432'
```

Port 3000 should show `127.0.0.1:3000` (or a private address), and a connection
to it from another machine must fail. Check the provider firewall too.

SSH recommendations: key-based auth only, `PasswordAuthentication no`,
`PermitRootLogin no`, a non-root sudo user, and optionally `fail2ban`. Keep
provider-console access as a recovery path.

## 11. Logs, health and monitoring

### Health check

`GET /api/health` returns `{ "status": "ok" }` with `Cache-Control: no-store`,
no authentication and the normal public rate limit. It is a **liveness** probe
and does not query PostgreSQL; a database outage must not make systemd restart a
healthy process. Use `pg_isready` or a separate readiness check for the database.

### Logs

- The app logs to stdout/stderr; systemd sends them to journald.
- `journalctl -u dheera-creatives -f`
- `journalctl -u dheera-creatives --since '1 hour ago'`
- Cap journald usage in `/etc/systemd/journald.conf` (`SystemMaxUse=1G`,
  `MaxRetentionSec=30day`) and restart journald.
- nginx access/error logs use the distribution's logrotate configuration.
- Do not log cookies, tokens, passwords, request bodies or `DATABASE_URL`.
  NestJS does not log them by default; keep it that way.

If PM2 is mandated instead of systemd, add `pm2-logrotate` and remember that
`pm2 save`/`pm2 startup` are additional operator steps. systemd remains the
recommended choice.

### Monitoring and alerting

Alert on:

- `/api/health` non-200 or timeout (external uptime checker).
- TLS certificate expiry (30/14/7 days).
- Disk space and inode usage on the upload and database volumes.
- PostgreSQL availability, connection count and slow queries.
- Application 5xx rate and unusual 429 volume.
- Backup age and verification failures.
- systemd restart loops (`systemctl status`, journal errors).

## 12. Rollback

### Code rollback

✅ Keep the previous release directory. ⚠️ Switching releases restarts the app:

```bash
sudo ln -sfn /opt/dheera-creatives/releases/<previous> \
             /opt/dheera-creatives/current
sudo systemctl restart dheera-creatives
sudo systemctl status dheera-creatives
```

### Database rollback

Migrations are forward-only. Rolling back code does not roll back the schema.
If a migration must be undone, restore the verified backup into a new database,
validate it, and switch the app only with explicit approval. Restoring over live
data loses every write made after the backup — treat it as a last resort.

### Uploads rollback

Restore only the files that were lost. Do not overwrite newer images blindly.
Files are additive and never deleted automatically, so a code rollback normally
leaves uploads untouched.

## 13. Post-deployment smoke tests

Run over HTTPS after DNS, TLS and the service are working.

✅ Read-only checks:

```bash
curl -fsS https://dheera.digimaraa.in/api/health
curl -fsS https://dheera.digimaraa.in/api/products
curl -fsS -o /dev/null -w '%{http_code}\n' https://dheera.digimaraa.in/
curl -fsS -o /dev/null -w '%{http_code}\n' https://dheera.digimaraa.in/admin/login
curl -fsS -o /dev/null -w '%{http_code}\n' \
  https://dheera.digimaraa.in/uploads/services/<existing-file>.webp
```

Manual checks:

1. `/` shows the public site and its images.
2. Hard-refresh `/admin/products` (a deep SPA route) still loads the dashboard.
3. Anonymous `GET /api/admin/products` returns `401`.
4. Admin login works over HTTPS and the browser shows `Secure`, `HttpOnly`
   session cookies with the `__Host-` prefix.
5. Logout and “Sign out everywhere” work and clear the cookies.
6. An existing `/uploads/...` image loads with `Cache-Control: immutable` and
   `X-Content-Type-Options: nosniff`.
7. `curl -I https://dheera.digimaraa.in/` includes HSTS and CSP.
8. Upload a small test image through the admin form and verify it displays.
9. The server clock, TLS certificate expiry and backup schedule look correct.

## 14. Command safety

✅ Safe / read-only:

`git status`, `npm test`, `npm run build`, `npx prisma validate`,
`npx prisma migrate status`, `nginx -t`, `systemctl status`, `journalctl`,
`pg_dump`, `pg_restore --list`, `tar --list`, `sha256sum`, `ss`, `ufw status`.

⚠️ Changes the server — verify the target first:

`npm ci`, `npm run db:migrate`, `systemctl restart`, `systemctl enable`,
`nginx` reloads, `certbot`, firewall changes, release symlink switches.

⛔ Destructive — never run against production without explicit approval and a
verified backup:

`prisma migrate reset`, `prisma db push --force-reset`, `DROP DATABASE`,
`TRUNCATE`, `pg_restore` over a live database, deleting or moving
`/var/lib/dheera/uploads`, disabling SSH or the firewall remotely.

## 15. What this repository does not do

It does not register the domain, create the server, install nginx or Certbot,
issue certificates, open firewall ports, create PostgreSQL roles, install the
systemd unit, configure backups/monitoring, or deploy anything publicly. Those
remain operator steps, and none of them should be reported as complete until
verified on the target host.
