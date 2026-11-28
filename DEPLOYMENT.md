# Deployment Guide — Hostinger Managed Web Apps (MariaDB)

Target environment (confirmed):
- **Hosting:** Hostinger Cloud Startup — managed Web Apps (not VPS)
- **Runtime:** Node.js 20 detected by Hostinger; exact patch version must be checked at runtime (see §1)
- **Build command:** `npm run build`
- **Output directory:** `dist` — Hostinger deploys this directory as the application root
- **Start entry:** `main.js` from the deployed `dist` root (locally: `npm start` → `node dist/main.js`)
- **Port / bind:** app reads `PORT` at runtime and binds `0.0.0.0` via `BIND_HOST`
- **Database (Hostinger production):** MariaDB `11.8.9-MariaDB-log` reached internally at `127.0.0.1:3306`; credentials supplied through hPanel; no external SSL required
- **Database (local development/tests):** MariaDB 11.8.10 at `127.0.0.1:3306`, database `dheera_test`
- **Domain:** temporary Hostinger domain is currently assigned; `https://dheera.digimaraa.in/` will be connected separately
- **Repository:** `digimaraa-technologies/dheera-creatives-demo1`

Application routes (served by the NestJS app when assets are present):
- `/` — public website (`public/`)
- `/admin` — React admin dashboard (`admin/dist/`); `/login` and `/admin-login` redirect to `/admin/login`
- `/api` — NestJS API
- `/uploads` — read-only static image serving; production uploads are disabled

> **Status:** this repository prepares the application; it does not perform deployment, DNS/TLS configuration, Hostinger panel setup, or database provisioning. Commands that change a server/database are operator actions to run only against verified targets with explicit approval.

## 1. Prerequisites and confirmed assumptions

- Hostinger Web App service with Node.js **20.x** detected. Minimum for this build: **Node 20.19.0** in the Node 20 branch (or **22.12.0+**), because Vite 8 requires `^20.19.0 || >=22.12.0`. Root `package.json` now declares the same range; generic Node 20 is not sufficient. Hostinger's exact patch version must be checked at runtime before claiming compatibility. Do not downgrade dependencies.
- Hostinger installs dependencies during the build using `npm ci` because `package-lock.json` exists. Root `dependencies` are available at runtime; devDependencies are needed during the build for `nest build`, `prisma generate`, and Prisma CLI migrations. Do not assume the automatic install includes them. If hPanel exposes a configurable install command, set `npm ci --include=dev`; otherwise confirm the platform install is not run with `--omit=dev` or with `NODE_ENV=production` suppressing devDependencies.
- Hostinger MariaDB `11.8.9-MariaDB-log` database is reachable from the Web App at `127.0.0.1:3306`; credentials are provided through hPanel and remain private. No external SSL is required for this internal connection.
- Environment variables are set in hPanel; `DATABASE_URL`, admin provisioning credentials, and other secrets are never committed.
- Deployment directories are **not persistent** and there is no persistent application filesystem for uploads (see §6).
- The temporary Hostinger domain is assigned for initial validation; the custom domain is connected separately.

**Still requires hPanel confirmation:**
- Exact Node.js 20 patch version at runtime.
- Whether devDependencies are installed during Hostinger's `npm ci` build (`prisma` and `@nestjs/cli` are devDependencies).
- Exact `PORT` value; Hostinger supports binding to `0.0.0.0`.
- Reverse-proxy hop count should be confirmed with Hostinger. Behind a reverse proxy, leaving `TRUST_PROXY=false` causes all visitors and admins to share one IP rate-limit bucket; verify the hop count (typically `1` for one Hostinger edge/reverse proxy) and set `TRUST_PROXY` to that hop count rather than `true` or leaving `false` behind a proxy.
- Database charset/collation defaults, connection limits, and whether the hPanel-provided `DATABASE_URL` needs URL options.
- Runtime `node_modules/` availability in the deployed artifact; repository root is the deployment root and output is `dist`.

## 2. Database (local MariaDB vs Hostinger MariaDB) and Prisma

- Prisma datasource provider: **`mysql`** for both environments. Prisma version: **6.19.x**; it supports local MariaDB 11.8.10 and Hostinger MariaDB 11.8.9 through the MySQL provider.
- **Local development/tests:** MariaDB 11.8.10, `mysql://USER:PASSWORD@127.0.0.1:3306/dheera_test`. This is the database used for the verified migrations and the 204-test suite.
- **Hostinger production:** MariaDB `11.8.9-MariaDB-log` at internal `127.0.0.1:3306`, represented as `mysql://DB_USER:DB_PASSWORD@127.0.0.1:3306/DB_NAME`. Use the exact user/password/database supplied by hPanel; URL-encode any reserved characters in credentials. No external SSL is required for this internal connection — do not add SSL options unless hPanel provides them.
- Fresh `mysql`-provider migration history is included on the `mysql` branch (`prisma/migrations/`, `migration_lock.toml` provider `mysql`). PostgreSQL migration history is not part of the active migration set.
- The production database is expected to be **empty**. No data migration from PostgreSQL or from the local test database is performed.

### Migration / initialization procedure (operator, approved target only)

Run in the deployed application environment (or a verified operator environment) with production `DATABASE_URL` configured. **Do not run against the Hostinger database from this development phase.**

```bash
npx prisma validate
npx prisma generate
npx prisma migrate deploy
npx prisma migrate status
```

- `prisma migrate deploy` applies committed migrations to an empty (or compatible) database.
- `prisma migrate status` must report the schema up to date.
- `prisma` is a devDependency. Run these commands from a verified operator environment where the CLI and `prisma/migrations/` are available (for example, the repository checkout with devDependencies installed). The running application does not load migrations at startup, so the copied `dist/prisma/` files are not required for normal request handling.
- **Never run:** `prisma migrate dev`, `prisma migrate reset`, `prisma db push --force-reset`, or any destructive operation.

### Initial admin provisioning

After migrations, create/reset the initial admin using environment-provided values only (never print or commit secrets):

```bash
# requires ADMIN_USERNAME, ADMIN_EMAIL, ADMIN_PASSWORD in the environment
npm run db:seed
# or, for controlled refresh of an existing/matching admin record per script rules:
npm run db:reset-admin
```

- Password must meet existing policy (minimum length and bcrypt byte limit enforced by scripts).
- Scripts refuse unsafe overwrites/merges as implemented; review output.

### Collation and comparison behavior (MariaDB)

- **Database/table default:** `utf8mb4` with `utf8mb4_unicode_ci` (case-insensitive) for application tables, to support Unicode text and intended case-insensitive behavior.
- **Usernames:** case-insensitive uniqueness (`admins.username`, unique index, case-insensitive collation).
- **Emails:** case-insensitive uniqueness (`admins.email`, unique index, case-insensitive collation).
- **Product slugs:** case-insensitive uniqueness (`products.slug`, unique index, case-insensitive collation).
- **Service slugs:** case-insensitive uniqueness (`services.slug`, unique index, case-insensitive collation).
- **Product/service name search:** case-insensitive (string comparisons/collation-driven; Prisma queries do not rely on PostgreSQL `mode: 'insensitive'`).
- **Session token hashes (`sessions.tokenHash`, unique) and CSRF hashes (`sessions.csrfHash`):** stored as SHA-256 hex digests and compared/looked up by exact hash value. These columns use explicit **binary/case-sensitive collation** (`utf8mb4_bin`) to preserve exact-value comparison and token identity semantics (no silent case-folding of hash values). Non-hash session fields remain under the table default collation.
- **`DATABASE_URL` scheme:** Prisma 6.19.x with the MySQL provider requires `mysql://` connection strings; application validation accepts `mysql://` only. For Hostinger use the internal `127.0.0.1:3306` connection supplied by hPanel; external SSL is not required. Never include or log real credentials.

## 3. Required environment variables

Set in Hostinger (names only; no real values shown). Production validation is strict.

Variable categories:

- **Operator-set application variables:** `NODE_ENV`, `BIND_HOST`, `DATABASE_URL`, `TRUST_PROXY`, `ADMIN_FRONTEND_ORIGIN`.
- **Hostinger-injected:** `PORT`.
- **Optional application/build variables:** `UPLOAD_DIR`, `SESSION_TTL_HOURS`, `SESSION_IDLE_TTL_MINUTES`, `VITE_API_BASE_URL`.
- **Provisioning-only; leave unset until migration and admin provisioning are explicitly approved:** `ADMIN_USERNAME`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`. Never leave a password in the deployment environment after provisioning.

| Variable | Required | Notes |
|---|---|---|
| `NODE_ENV` | **Yes** | `production` in deployed environments (enables secure cookie/HSTS behavior and production checks). |
| `DATABASE_URL` | **Yes** | MariaDB/MySQL connection string for Prisma. Must use the `mysql://` scheme (Prisma 6.19.x MySQL provider; `mariadb://` not accepted). For Hostinger use the internal `127.0.0.1:3306` credentials/database from hPanel; no external SSL is required. Secret. |
| `PORT` | **Yes (runtime)** | Injected by Hostinger Web Apps; app listens on `Number(PORT) || 3000`. Do not hardcode a production port. |
| `BIND_HOST` | **Yes (production)** | Set to `0.0.0.0` as required by Hostinger. Must be explicit; the app warns on wildcard binds and production validation requires the variable to be present. |
| `TRUST_PROXY` | **Yes (production)** | Set to the verified reverse-proxy hop count (`1` behind Hostinger's edge proxy; `0`/`false` only if reached directly without a proxy). Leaving `false` behind a proxy puts every visitor and admin into one shared rate-limit bucket; never set `true`. |
| `ADMIN_FRONTEND_ORIGIN` | **Yes (production)** | Comma-separated, host-exact allowlist for credentialed API/CORS and login `Origin`. Must be `https://...`. Use the currently assigned temporary HTTPS origin for initial validation; switch to `https://dheera.digimaraa.in` when the custom domain is connected. |
| `UPLOAD_DIR` | Optional (default `uploads`) | Read-only static serving root. Hostinger confirms no persistent application filesystem, so contents are **not durable**; production uploads stay disabled (see §6). |
| `SESSION_TTL_HOURS` | Optional (default `8`, 1–720) | Absolute admin session lifetime. |
| `SESSION_IDLE_TTL_MINUTES` | Optional (default `30`, 1–720) | Idle session timeout. |
| `ADMIN_USERNAME` | Seed/reset only | Initial admin username (provisioning commands). |
| `ADMIN_EMAIL` | Seed/reset only | Initial admin email. |
| `ADMIN_PASSWORD` | Seed/reset only | Initial admin password (secret). |
| `VITE_API_BASE_URL` | Conditional (admin build-time) | Leave empty for same-origin deployment; set only if the admin must call a different API origin at build time. |

**Production startup requirements (enforced):** explicit `TRUST_PROXY` (`false` or a verified hop count), explicit `BIND_HOST`, and `https://` `ADMIN_FRONTEND_ORIGIN`. Do not weaken authentication, origin, cookie, CSRF, or rate-limit protections.

## 4. Build and start (Hostinger Web Apps)

### Root scripts (package.json)

- `npm run build` — `prisma generate` → `nest build` → `npm --prefix admin ci` + Vite build → `node scripts/copy-build-assets.js`. Produces a self-contained `dist/` and regenerates Prisma Client.
- `npm run build:server` — NestJS backend only (cleans then compiles into `dist/`).
- `npm run build:admin` — reproducible admin install + Vite production build (base `/admin/`).
- `npm start` — local alias for `npm run start:prod` → `node dist/main.js`.
- `npm run start:prod` — local compiled-entry launcher.
- `postinstall` — `prisma generate` during `npm ci`; the build also generates explicitly.

### Hostinger commands and layout (confirmed)

- **Dependency install:** Hostinger runs `npm ci` using `package-lock.json`. `@prisma/client` is a runtime dependency; `prisma` remains a devDependency and is available during the build/migration environment. Do not move `prisma` into runtime dependencies without a proven need.
- **Build command:** `npm run build`, run from the repository root. It explicitly runs `prisma generate` before the NestJS build, so the generated client and native query engine match the deployed schema.
- **Output directory:** `dist`. Hostinger deploys this directory as the runtime root.
- **Start entry:** `main.js` from the deployed `dist` root. No repository-root files outside `dist` are required by the running app.
- **Runtime dependencies:** root `dependencies` are available at runtime; `node_modules/` is not copied into `dist/`.

For local/CI reproducibility: `npm ci && npm run build`, then `npm start`.

### Hostinger panel settings to enter

| Setting | Value |
|---|---|
| Repository root / deployment root | Repository root (confirmed) |
| Node.js version | Any version satisfying `^20.19.0 \|\| >=22.12.0`; on the Node 20 branch this means **20.19.0 or newer**. Verify with `node --version` at runtime. |
| Install command | `npm ci --include=dev` if configurable. If not configurable, confirm the automatic `npm ci` does not omit devDependencies. |
| Build command | `npm run build` |
| Output directory | `dist` |
| Start entry / command | `main.js` from the deployed `dist` root (`node main.js`) |
| Port | Use the Hostinger-injected `PORT`; do not hardcode a production port. |
| Bind address | `0.0.0.0` via `BIND_HOST` (recommended by Hostinger) |

Do not set `TRUST_PROXY=true` or a guessed hop count. Start with `TRUST_PROXY=false`.

## 4A. Custom domain and SSL (operator)

- Keep the currently assigned temporary HTTPS Hostinger domain for first validation.
- Enable/verify TLS for `dheera.digimaraa.in` in hPanel before pointing `ADMIN_FRONTEND_ORIGIN` at it.
- After DNS and TLS for the custom domain are confirmed, set `ADMIN_FRONTEND_ORIGIN=https://dheera.digimaraa.in` (or the exact HTTPS origin Hostinger serves) and restart the app.
- Repeat the §8 verification checklist after the domain switch. Do not change DNS or TLS in this preparation phase.

## 5. Deployment packaging

Hostinger deploys only `dist`, so the build places every file the server reads inside it. After `npm run build` the required structure is:

```text
dist/
  main.js
  public/index.html
  public/**                 # public website, CSS/JS/images/config
  admin/dist/index.html
  admin/dist/**             # built React admin + hashed assets
  prisma/schema.prisma
  prisma/migrations/**      # includes migration_lock.toml
  ...compiled NestJS JS...  # auth/, common/, products/, services/, uploads/, etc.
```

Path resolution is layout-aware:

- `public/` and `admin/dist/` are located by searching the runtime working directory and the compiled entry directory. This works both locally (`<repo>/dist/main.js`) and on Hostinger (`<deployed>/main.js`).
- Admin deep links still fall back to `index.html`; missing asset paths (with extensions) still return 404, not SPA HTML.
- A relative `UPLOAD_DIR` is resolved under that same asset root; an absolute path is used as-is. Uploads stay read-only in production (§6).
- Prisma schema/migrations are copied into `dist/prisma/` for operator/audit use. The running app does not read them; migrations are run separately (§2).

Root dependencies are available at runtime; `node_modules/` is not copied into `dist/`. Bind address remains `0.0.0.0` via `BIND_HOST`.

## 6. Image uploads and storage limitation (important)

- **Local development:** existing local upload behavior is preserved (uploads stored under `UPLOAD_DIR`, default `uploads/`, served at `/uploads/...` with validation and safe headers).
- **Hostinger managed Web Apps (confirmed):** deployment directories are not persistent and there is no persistent application filesystem for uploads. **Local app-directory uploads are not durable and must remain disabled.** In production `serveUploads()` does not create `UPLOAD_DIR` at startup; the `/uploads` route stays registered but returns 404 when no durable files exist. Do not set `UPLOAD_DIR` to temporary storage or rely on its contents surviving a redeploy.
- **Production guard:** when `NODE_ENV=production`, upload endpoints **do not save files** and return a clear, non-sensitive error indicating durable image storage is not configured (uploads unavailable until persistent storage is set up). This prevents false-success uploads to unverified/non-persistent storage.
- **Existing data/URLs:** existing image files and database references must not be deleted by this conversion; image retrieval/public URL behavior remains supported for environments where files are present.
- **Product/service CRUD:** remains available; image upload availability depends on configured durable storage.

**Future requirement (not implemented):** production image uploads require a later S3-compatible storage integration or another confirmed durable storage solution. Do not implement external/third-party storage without approval. If Hostinger provides a confirmed persistent writable mount, configure and verify it (path, permissions, backups, persistence across deploys) before relying on uploads.

## 7. Security preservation

The deployment must preserve existing protections:
- Admin authentication and session handling (hashed session tokens, HttpOnly cookies, CSRF protection, origin validation)
- Password hashing and password-change flow (transactional update, session revocation, lockout and bounded admission)
- Login/API rate limiting and admin authorization
- Security headers and CORS restrictions
- Upload validation (MIME/magic-byte, size limits, UUID filenames), safe static serving, and DTO validation/sanitization
- Existing error handling

**MariaDB 11.8.9-specific checks:** confirm server charset/collation defaults and that they honor the documented comparison behavior (case-insensitive username/email/slug uniqueness and name search; exact/binary comparison for session token/CSRF hash columns), CHECK constraint enforcement, `DECIMAL(10,2)`/`DATETIME(3)` handling, internal connection settings, and real-client-IP behavior with `TRUST_PROXY=false`. Only set a numeric hop count after hPanel provides a verified value.

## 8. Verification checklist (post-deploy, operator)

- Validate the built `dist` artifact from its own root (simulate Hostinger) before upload.
- Confirm runtime `node --version` satisfies `^20.19.0 || >=22.12.0` before running the build.
- With `TRUST_PROXY=false`, verify rate-limit/client-IP behavior is acceptable from two distinct external clients; obtain a verified hop count before changing it.
- `GET /api/health` responds OK.
- Validate first on the assigned temporary HTTPS Hostinger domain, then repeat after `https://dheera.digimaraa.in` is connected and `ADMIN_FRONTEND_ORIGIN` is updated.
- `/` serves public site and assets; `/admin` SPA loads (including deep-link refresh).
- Admin login/logout/session behavior works over HTTPS with secure cookies and CSRF protections.
- Product/service read and CRUD (as authorized) function correctly against the Hostinger MariaDB 11.8.9 database through the Prisma `mysql` provider.
- Existing images (if present on persistent storage) load from `/uploads/...`.
- Production upload attempts fail safely with the documented storage-not-configured error when durable storage is not configured.
- `prisma migrate status` reports up to date on the target database.
- Logs contain no secrets/credentials.

## 9. Command safety

- **Safe/read-only:** `npx prisma validate`, `npx prisma migrate status`, `npm test`, `npm run build`, `node --check`/status checks, log inspection.
- **Operator changes (verify target):** `npm ci`, `npm run build`, `npx prisma migrate deploy`, `npx prisma generate`, `npm run db:seed` / `db:reset-admin`, start/restart via Hostinger.
- **Never (without explicit approved safeguards):** `prisma migrate reset`, `prisma db push --force-reset`, destructive DB operations, deploying unreviewed branches, or exposing secrets.
