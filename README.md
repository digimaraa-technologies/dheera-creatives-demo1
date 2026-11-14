# Dheera Creatives - Website

A premium, responsive website for Dheera Creatives, a handcrafted Aari embroidery and custom stitching brand.

> The public frontend lives in `public/` and is served unchanged by the NestJS app. The
> admin dashboard is a separate React app in `admin/`. Paths below are relative to the
> project root unless stated otherwise.

## Project Overview

This website showcases handcrafted Aari embroidery, custom blouse designs, and personalized stitching services. Built with vanilla HTML5, CSS3, and JavaScript, the site focuses on elegance, craftsmanship, and converting visitors into custom order enquiries.

## Features

- Responsive design (desktop, tablet, mobile)
- Premium hero section with floating credibility cards
- Product/collection gallery
- Full photo gallery (24 images) with a keyboard-accessible lightbox and per-photo WhatsApp enquiry
- About, Process, Testimonials, FAQ sections
- Contact and enquiry functionality
- Dynamic configuration via config.js
- SEO optimized with meta tags, robots.txt, sitemap.xml
- Accessible design with proper ARIA attributes

## Tech Stack

- NestJS (TypeScript) serving the site and providing the backend
- PostgreSQL 17 with Prisma ORM 6
- React + TypeScript + Vite admin dashboard (`admin/`)
- HTML5 (Semantic)
- CSS3 (Custom Properties, Flexbox, CSS Grid)
- Vanilla JavaScript (ES6+) for the public site
- No build step for the public site; the admin app has its own

## Project Structure

```
dheera_creatives_demo1/
├── public/                 # Public website, served as-is by NestJS
│   ├── index.html          # Main HTML file
│   ├── styles.css          # All styles
│   ├── script.js           # Interactive functionality
│   ├── config.js           # Centralized configuration
│   ├── robots.txt          # SEO robots file
│   ├── sitemap.xml         # SEO sitemap
│   ├── manifest.json       # PWA manifest
│   └── assets/
│       ├── aari-embroidery-about.webp        # About section image
│       ├── aari-embroidery-contact.webp      # Contact card image
│       ├── aari-embroidery-hero.webp         # Unused legacy hero
│       ├── embroidery/                       # 24 gallery photos
│       │   └── thumbs/                       # 640px grid previews
│       ├── products/                         # 6 collection card images
│       ├── logo/                             # Brand artwork + og-image
│       └── icons/                            # Favicon / PWA icons
├── admin/                  # Separate React + Vite admin dashboard
│   ├── index.html          # Admin shell (noindex)
│   ├── vite.config.ts      # Dev server, /api + /uploads proxy, Vitest config
│   ├── src/
│   │   ├── api/            # fetch client (cookies + CSRF), auth, catalogue
│   │   ├── components/     # layout, route guards, dialogs, uploader
│   │   ├── hooks/          # AuthProvider, ToastProvider
│   │   ├── pages/          # login, dashboard, list, form, 404
│   │   ├── test/           # Vitest + Testing Library suites
│   │   ├── App.tsx
│   │   └── styles.css      # Design system (CSS variables)
│   └── .env.example        # Optional VITE_API_BASE_URL
├── uploads/                # Runtime image storage (git-ignored)
│   ├── products/           # Uploaded product images
│   └── services/           # Uploaded service images
├── src/                    # NestJS application
│   ├── main.ts             # Bootstraps Nest, CORS and static serving
│   ├── app.module.ts
│   ├── config/
│   │   └── env.validation.ts   # Joi validation of env vars
│   ├── auth/
│   │   ├── auth.module.ts      # Throttler config; exports AuthService + guard
│   │   ├── auth.controller.ts  # login / me / logout endpoints
│   │   ├── auth.service.ts     # bcrypt check, session create/validate/delete
│   │   ├── auth.cookies.ts     # cookie names, options, CSRF helpers
│   │   ├── auth.types.ts       # SafeAdmin shape + request typing
│   │   ├── dto/login.dto.ts
│   │   ├── guards/admin-auth.guard.ts
│   │   └── decorators/current-admin.decorator.ts
│   ├── common/                 # slug generation, pagination, query DTOs
│   ├── products/               # public + admin product CRUD
│   ├── services/               # public + admin service CRUD
│   ├── uploads/                # guarded upload endpoint, storage, validation
│   └── prisma/
│       ├── prisma.module.ts    # Global database module
│       └── prisma.service.ts   # Reusable PrismaClient wrapper
├── prisma/
│   ├── schema.prisma       # Admin, Session, Product and Service models
│   ├── seed.ts             # Idempotent admin seed (bcrypt)
│   └── migrations/         # SQL migrations applied with migrate deploy
├── test/
│   ├── app.e2e-spec.ts     # Static delivery and 404 tests
│   ├── database.e2e-spec.ts # Real PostgreSQL schema checks
│   ├── auth.e2e-spec.ts    # Login, sessions, CSRF and rate limiting
│   ├── products.e2e-spec.ts # Public + admin product API
│   ├── services.e2e-spec.ts # Public + admin service API
│   ├── uploads.e2e-spec.ts  # Upload validation, storage and cleanup
│   └── helpers/             # Shared test app / session helpers
├── .env.example            # Required variables, no secrets
├── package.json
├── nest-cli.json
├── tsconfig.json
├── tsconfig.build.json
├── tsconfig.test.json
└── README.md
```

> `assets/logo.svg` and `assets/favicon.svg` are earlier placeholder marks that are no
> longer referenced now that the real brand artwork is in place. They are safe to delete.

## How to Update

### Brand Logo
The header and footer logo artwork is **JPEG**, so those files carry an opaque light
background (sampled at `#f4f3f1` for the header mark and `#f1f3f0` for the footer mark).
Placing that straight onto the dark evergreen header or footer would show a light
rectangle, so each logo sits on a `.logo-plate` — a rounded panel whose background colour
matches the artwork, making the logo read as a deliberate chip.

`.logo-plate` uses `#f2f1ef`, which sits within 2/255 of both artwork backgrounds — a
difference that is not perceptible. (The favicon source is separate: it is a **PNG** with a
genuine transparent background, so it needs no plate at all.)

Logo paths live in `config.js` under `client.logo`:

| Key | File | Placed in |
| --- | --- | --- |
| `header` | `assets/logo/primary-horizontal.jpg` | Site header |
| `footer` | `assets/logo/secondary-stacked-trimmed.jpg` | Footer brand column |
| `wordmark` | `assets/logo/wordmark.jpg` | Reserved, not currently placed |

Notes:

- The header `<img>` in `index.html` carries the same path as a fallback, so the logo
  still appears if `config.js` fails to load.
- `secondary-stacked-trimmed.jpg` was produced from the supplied
  `secondary-stacked.jpg` by removing its large empty canvas (the artwork occupied
  946×598 of a 1080×1080 square) and downscaling to 480px wide. The original is kept.
- **If you replace the footer logo**, update the `width`/`height` attributes in
  `footerBrandMark()` in `script.js` to match the new file, otherwise the browser
  reserves the wrong space and the layout shifts as the image loads.
- **If you replace the header logo**, update the `width`/`height` attributes on
  `<img id="headerLogo">` in `index.html` to the new file's real pixel size, otherwise
  the browser reserves the wrong aspect ratio and the layout shifts as the image loads.
- Icon files in `assets/icons/` were generated from `assets/logo/favicon.png`.
- **Naming rule:** keep logo filenames lowercase-with-hyphens. Spaces, parentheses and
  capitals (`Primary (Horizontal).jpg`) break on case-sensitive hosts and need
  URL-encoding, which is why the artwork is stored as `primary-horizontal.jpg`.

**Ideally, ask your designer for SVG (or transparent PNG) versions of the logo.** With
transparency the plates can be removed entirely and the logo will sit directly on the
dark header and footer:

```css
.logo-plate { background: transparent; padding: 0; }
```

### Favicon
`assets/icons/` is generated from `assets/logo/favicon.png`. That artwork is **already a
circle on a transparent canvas** (the visible mark fills an inscribed circle; the corners
are fully transparent), so the icon set simply resizes it — no synthetic corner rounding
is applied, and the round shape is preserved at every size.

| File | Shape | Why |
| --- | --- | --- |
| `favicon.ico`, `favicon-16/32/48.png` | round, transparent corners | Tab / bookmark icon |
| `icon-192.png`, `icon-512.png` | round, transparent corners | PWA / shortcut icons |
| `apple-touch-icon.png` (180×180) | **opaque square** | iOS composites icon alpha over **black** and applies its own squircle mask, so transparent corners would show up black on the home screen. This one is composited on the disc's own edge colour (`#f2f2f0`), which makes the circle boundary disappear and keeps the tile light. |

> The source file is a **PNG** containing the circular mark. If you re-export it, keep it
> as `favicon.png` and regenerate the set, otherwise `index.html`'s JSON-LD `logo` and the
> manifest will point at a stale file.

Browsers cache favicons extremely aggressively — `chrome://favicon` and the OS icon cache
are sticky. After changing them, clear the icon cache or test in a fresh profile/private
window, otherwise you may still see the previous icon.

### Site domain (`config.js` → `website.url`)
The domain is configured in **one place**, `config.js`:

```js
// config.js
website: {
  url: "https://dheera.digimaraa.in",   // no trailing slash
  ...
}
```

Set to the production origin, `https://dheera.digimaraa.in`. If it is ever left reading
`REPLACE_WITH...`, the script falls back to `window.location.origin`, so any deployed or
previewed copy fills in the correct origin automatically without edits.

**What is config-driven.** The two JSON-LD blocks in `index.html` carry the literal token
`__SITE_URL__`, which `applySiteUrl()` in `script.js` replaces at runtime. Google executes
JavaScript, so it sees the resolved values — search/structured data stays single-source.

**What is hard-coded, and why.** Social crawlers — Facebook, WhatsApp, X, LinkedIn, Slack,
Discord, iMessage — read raw HTML and **never run JavaScript**. A config-driven value is
therefore invisible to them, and no pure-static site can work around that: making it dynamic
would need server-side templating or a build step that rewrites HTML at deploy time, neither
of which is implemented yet (NestJS currently serves the frontend files as-is). So three spots are literal URLs,
all currently pointing at `https://dheera.digimaraa.in`:

| Where | Value | Note |
|---|---|---|
| `index.html` `og:url` | `https://dheera.digimaraa.in/` | absolute, per Open Graph spec |
| `index.html` `og:image`, `twitter:image` | `https://dheera.digimaraa.in/assets/logo/og-image.jpg` | must be fetchable without JS |
| `sitemap.xml`, `robots.txt` | `https://dheera.digimaraa.in/...` | crawlers read these files directly |

`canonical` avoids the problem entirely: it is the root-relative `href="/"`, which resolves
correctly on any host (production, preview, localhost) and can never go stale.

> ⚠️ **If the domain ever changes**, update `website.url` in `config.js` **plus** the four
> hard-coded spots above (`og:url`, `og:image` and `twitter:image` in `index.html`, and
> `sitemap.xml` / `robots.txt`). Grep for the old domain to find them all.

### Open Graph preview: "could not load image"

Every share preview fetches the image URL itself. If it reports it could not load:

1. **A crawler once saw a non-public URL.** A common cause is pointing `og:image` at a
   local dev server (`https://127.0.0.1:5500/...` or `http://localhost:...`) — no crawler
   can reach your machine. The URL must be a public `https://` address.
2. **The page URL must be public.** Crawlers cannot reach `localhost`, `file://`, or a
   private/preview deployment. Test against the production URL.
3. **The image URL must be absolute `https://`.** Crawlers do not resolve relative paths.
4. **`og:image` must be a hard-coded absolute URL.** It already is. If it ever
   contains `__SITE_URL__`, non-JS crawlers cannot resolve it — put the absolute URL
   back in `index.html`.
5. **Force a re-scrape.** Platforms cache aggressively — use Facebook's Sharing Debugger
   (Scrape Again), LinkedIn Post Inspector or X's Card Validator. Always clear the
   cached scrape after fixing the URL.

The file itself has been checked and is sound: `assets/logo/og-image.jpg` is a complete
baseline JPEG (not progressive), exactly 1200×630, sRGB, EXIF orientation 1, no ICC
profile, ending in a valid EOI marker. No known crawler rejects those characteristics.

### Update Hero Image
1. Replace `assets/embroidery/aari-embroidery-design-15.webp` with your own Aari embroidery image
2. Use a legitimate, non-watermarked image (own photography or a licensed/properly attributed source)
3. The hero frame is **4:5 portrait** (`.hero-image-wrapper` in `styles.css`). A differently
   shaped photo still works — `object-fit: cover` crops it to the slot — but a 4:5 source
   shows uncropped
4. Update the `width`/`height` attributes on the hero `<img>` in `index.html` to the new
   file's real pixel dimensions so the layout reserves the right space before load

The hero `<img>` is the **only** place the hero photo is referenced, and the surrounding
comment in `index.html` marks the location for quick editing. The now-unused legacy file
`assets/aari-embroidery-hero.webp` can be deleted.

### Gallery and lightbox
The gallery section (`#gallery`) shows **24 photos** in a masonry-style column layout.
It intentionally does **not** use a fixed-ratio grid: the supplied photos mix 4:5 portrait,
16:10 landscape and 9:16 frames, and columns keep every photo at its true aspect ratio
rather than cropping them into one shape.

Each gallery entry is a plain link to the full-size image:

```html
<a class="gallery-item" href="assets/embroidery/aari-embroidery-design-01.webp">
    <img src="assets/embroidery/thumbs/aari-embroidery-design-01.webp"
         alt="Handcrafted Aari embroidery by Dheera Creatives, gallery image 1"
         width="640" height="400" loading="lazy" decoding="async">
</a>
```

Why it is built this way:

- The grid loads only the **640px preview** in `thumbs/` (≈1.6 MB for all 24, far less in
  practice because `loading="lazy"` defers everything below the fold).
- The `href` points at the **full-size** photo, so the link still works — and stays
  crawlable — with JavaScript disabled.
- `width`/`height` on every `<img>` reserves the correct box so the masonry does not
  reflow as photos load.

`initGallery()` in `script.js` intercepts a plain left-click and opens the photo in a
lightbox instead. Modifier-clicks (Ctrl/Cmd/middle) and JavaScript-disabled visitors keep
the normal link behaviour. The lightbox supports:

- **Esc** to close, **← / →** to browse, **Tab** is trapped inside the dialog
- Focus returns to the thumbnail you opened it from
- Swipe left/right on touch devices
- Page scroll is locked while open

#### "Enquire Now" → WhatsApp
The lightbox button pre-fills a WhatsApp chat with the photo you are looking at:

```
https://wa.me/<number>?text=<pre-filled message>
```

- The number comes from `client.whatsapp` in `config.js`.
- The message text comes from `enquiry.whatsappMessage`. `{image}` is replaced at click
  time with the **absolute URL** of the current photo, so the brand can see which design
  the enquiry refers to.
- If `client.whatsapp` is empty, the button falls back to the client's Instagram DM rather
  than becoming a dead link.

> ⚠️ **WhatsApp cannot attach a file from a link.** Click-to-chat (`wa.me`) only pre-fills
> *text* — there is no way for a static site to attach the actual image file. The photo is
> therefore sent as a **link** inside the message. For the link to be useful (and for
> WhatsApp to render a preview thumbnail) the site must be **deployed at its public domain**
> — `website.url` in `config.js` must be the real domain. It is set to
> `https://dheera.digimaraa.in`.
> A truly attached image would require the WhatsApp Business API and a backend, which this
> static site does not have.

> ⚠️⚠️ **The WhatsApp number is currently DigiMaraa's, not the client's.** `client.whatsapp`
> in `config.js` is set to the developer's number as a temporary stand-in so the demo button
> works. **Replace it with Dheera Creatives' own WhatsApp number before launch**, otherwise
> every customer enquiry will go to the developer instead of the brand.

#### Swapping the photos
The 24 photos, their previews and the nine slot images (hero, about, contact, six collection
cards) were produced by a resize/crop pass over the supplied images. To change the set:

1. Put the new source photos in `assets/embroidery/`.
2. Re-run that asset pass to regenerate the numbered files and `thumbs/`.
3. Re-generate the 24 `<a class="gallery-item">` blocks in `index.html` — they are plain,
   static markup, so the numbering, `width`/`height` and `alt` must match the new files.
4. Update the shadowed copies in `assets/products/` and the three slot images at the
   `assets/` root if the slot crops change too.

#### Alt text
Alt text is currently **accurate but generic** — “Handcrafted Aari embroidery by Dheera
Creatives, gallery image N” — because the photo contents were not described when they were
supplied. Nothing is fabricated, but it is also not keyword-rich. If you want stronger image
SEO, send a one-line description for each photo and the `alt` values (and ideally the
filenames) can be made specific.

### Asset inventory
| Asset | Purpose | Notes |
| --- | --- | --- |
| `assets/embroidery/aari-embroidery-design-01..24.webp` | Gallery, full size | Loaded by the lightbox only |
| `assets/embroidery/thumbs/*.webp` | Gallery grid previews | 640px wide, what the page actually loads |
| `assets/embroidery/aari-embroidery-design-15.webp` | Hero image | 1080×1350, shown in a 4:5 frame |
| `assets/aari-embroidery-hero.webp` | Unused legacy hero | 4:3 crop; kept for reference, no longer referenced |
| `assets/aari-embroidery-about.webp` | "Crafted with Passion" image | 6:5 crop |
| `assets/aari-embroidery-contact.webp` | Dheera Creatives contact card | 16:10 crop |
| `assets/products/aari-embroidery-collection-1..6.webp` | Collection cards 1–6 | 4:3 crops |
| `assets/testimonials/` | Empty — add authentic customer photos here | |
| `assets/process/` | Empty — reserved for future real assets | |

> The hero, about, contact and collection images are **crops of photos that also appear in the
> gallery**, not separate photographs. They are deliberately stored at slot-specific sizes so
> each loads only as much data as it displays.

Placeholder review content is clearly labelled in the testimonials section. Replace it with
verified customer feedback before launch.

### Update Contact Information
All contact details live in `config.js` and are rendered by `script.js`. Nothing is hardcoded
in `index.html` (the values present in the HTML are non-authoritative fallbacks shown only if
JavaScript is disabled). Editing `config.js` updates:

- The Instagram link used by every CTA
- The DigiMaraa address, phone and email links in the contact section
- The enquiry form recipient
- The footer, including the dynamic copyright year and the development credit
- The document `<title>` and meta description

### Enquiry Form Configuration
The on-page enquiry form at `#contact` has **no backend**. On submit it validates the fields
in the browser and opens a pre-filled email draft in the visitor's own mail app using a
`mailto:` link. Nothing is transmitted or stored by this website.

The gallery lightbox (`#gallery`) takes a different path: its "Enquire Now" button opens a
WhatsApp chat pre-filled with the photo that the visitor is looking at. See
[Gallery and lightbox](#gallery-and-lightbox) for details.

The email recipient is resolved in this order from `config.js`:

1. `enquiry.recipientEmail` — if set to a non-empty address
2. `agency.newBusinessEmail` — the default fallback
3. `agency.enquiriesEmail`

To send enquiries somewhere else, set `enquiry.recipientEmail` in `config.js`:

```js
enquiry: {
  recipientEmail: "orders@example.com",
  subjectPrefix: "Custom Order Enquiry",
  whatsappMessage: "Hi Dheera Creatives! I would like to enquire about this design: {image}"
}
```

**Important limitation:** a `mailto:` form depends on the visitor having a mail client
configured. If real server-side delivery is required later, the form should be connected to a
form-handling service or backend endpoint and this README updated accordingly.

### Customization
- Colors: edit the CSS custom properties in the `:root` block of `styles.css`
- Typography: update the Google Fonts link in `index.html` (system fallbacks are already defined)
- Content: edit copy directly in `index.html`

### SEO / Deployment Configuration
The domain is configured in **`config.js`**:

```js
website: {
  url: "https://dheera.digimaraa.in",   // no trailing slash
  ...
}
```

Current production origin: **https://dheera.digimaraa.in**.

**Config-driven (JSON-LD).** The two JSON-LD blocks in `index.html` contain the token
`__SITE_URL__`, substituted at runtime by `applySiteUrl()` in `script.js`. Google executes
JavaScript, so it sees the resolved values. If `website.url` is unset, the browser's own
origin is used, so the site works correctly on any host automatically.

**Hard-coded (everything a non-JS crawler needs).** Social crawlers do not execute
JavaScript, so these must be literal absolute URLs in the served HTML:

| File | Where | Current value |
| --- | --- | --- |
| `index.html` | `og:url` | `https://dheera.digimaraa.in/` |
| `index.html` | `og:image`, `twitter:image` | `https://dheera.digimaraa.in/assets/logo/og-image.jpg` |
| `sitemap.xml` | the `<loc>` entry | `https://dheera.digimaraa.in/` |
| `robots.txt` | the `Sitemap:` line | `https://dheera.digimaraa.in/sitemap.xml` |

`canonical` is deliberately root-relative (`href="/"`) so it is correct on any host without
needing a domain at all.

> ⚠️ **Changing the domain** means editing `config.js` **and** the four URLs in the table
> above. A pure-static site cannot make the og/twitter tags dynamic — that would require a
> build step or server-side templating.

The Open Graph / Twitter image **must** be an absolute URL — crawlers do not resolve
relative paths. `assets/logo/og-image.jpg` is already 1200×630, the exact ratio required.

### Placeholder Assets To Replace
There are no placeholder **images** left: the hero, about, contact and collection slots all
use the supplied embroidery photographs, and the gallery shows all 24 of them. See
[Asset inventory](#asset-inventory) for the full list.

What still needs real content before launch:

| Item | Where |
| --- | --- |
| Customer testimonials | `index.html`, testimonials section (currently labelled placeholder copy) |
| WhatsApp number | `config.js` → `client.whatsapp` (currently the developer's number) |
| Final domain | `config.js` → `website.url`, plus `sitemap.xml` and `robots.txt` |
| `assets/testimonials/` | Empty — add authentic customer photos here |


## Database

PostgreSQL 17, accessed through Prisma ORM 6. Prisma 7 and later are ESM-only, while this app compiles to CommonJS, so the last CommonJS-compatible major is used.

Set `DATABASE_URL` in `.env` (see `.env.example`). It is validated at boot: the app refuses to start if it is missing or is not a `postgresql://` URL.

| Model | Table | Notes |
|---|---|---|
| `Admin` | `admins` | UUID id, unique `username` and `email`, bcrypt `passwordHash` |
| `Session` | `sessions` | UUID id, unique `tokenHash` (SHA-256 hex), `adminId` FK with `ON DELETE CASCADE`, `expiresAt` |
| `Product` | `products` | UUID id, unique `slug`, optional `Decimal(10,2)` price, `imageUrl` + nullable `imageFilename`, indexes on `category` and `(isActive, displayOrder)` |
| `Service` | `services` | same shape as `Product` |

Both content tables also carry `CHECK` constraints that reject negative prices.

Apply migrations and generate the client:

```bash
npm run db:migrate     # prisma migrate deploy
npm run db:generate    # prisma generate (also runs on npm install)
```

Seed the first admin. Credentials are read from the environment and never stored in the repo:

```powershell
$env:ADMIN_USERNAME="admin"
$env:ADMIN_EMAIL="admin@example.com"
$env:ADMIN_PASSWORD="a-password-of-12-or-more-characters"
npm run db:seed
```

Re-running the seed refreshes the password hash for the same account and never creates a duplicate. It refuses to overwrite an account whose username or email differs.

### Reset an admin password

If an existing admin's password is unknown, refresh it without creating a duplicate or touching other data:

```powershell
$env:ADMIN_USERNAME="admin"
$env:ADMIN_EMAIL="admin@example.com"
$env:ADMIN_PASSWORD="a-password-of-12-to-128-characters"
npm run db:reset-admin
Remove-Item Env:ADMIN_USERNAME,Env:ADMIN_EMAIL,Env:ADMIN_PASSWORD
```

The script hashes the password with bcrypt cost 12, matching the auth service. It updates the admin matching the username or email, or creates one if neither exists. It aborts without writing if the username and email belong to two different admins, never deletes admins, and never prints the password or hash.

`prisma migrate dev` needs a shadow database, which the `dheera_app` role cannot create. New migrations are generated with `prisma migrate diff --from-empty --to-schema-datamodel prisma/schema.prisma --script` (or `--from-migrations` for later changes) and applied with `npm run db:migrate`.

## Admin Authentication

Server-side session authentication for the admin API. The public site stays public: only routes that explicitly use `AdminAuthGuard` require a session.

| Endpoint | Method | Auth | Purpose |
|---|---|---|---|
| `/api/auth/login` | POST | public | `{ "identifier": "<username or email>", "password": "..." }` → `{ "admin": {...} }` + cookies |
| `/api/auth/me` | GET | session | Current admin's safe fields (`id`, `username`, `email`, `createdAt`, `updatedAt`) |
| `/api/auth/logout` | POST | session + CSRF | Deletes the session row and clears both cookies |

There is deliberately **no registration endpoint**. Admins are created with `npm run db:seed` and an existing password can be repaired with `npm run db:reset-admin`.

### Session and CSRF contract (needed by the Phase 5 admin UI)

- `dheera_session` — opaque 256-bit random token, `HttpOnly`, `SameSite=Lax`, `Secure` when `NODE_ENV=production`, `Path=/`. The database stores only its SHA-256 hash in `sessions.tokenHash`.
- `dheera_csrf` — the CSRF token, readable by JavaScript (not `HttpOnly`), same flags otherwise.
- **Every non-GET/HEAD/OPTIONS request to a guarded route must send the CSRF cookie value back in an `x-csrf-token` header.** Double-submit is enforced inside `AdminAuthGuard`, so a guarded route cannot accidentally skip it.
- Session lifetime is `SESSION_TTL_HOURS` (default `8`, max `720`). Expired sessions are rejected and deleted on the next request.
- The browser never needs `localStorage`/`sessionStorage`; cookies carry the session.

### Protecting new admin routes

```ts
import { UseGuards } from '@nestjs/common';
import { AdminAuthGuard } from '../auth/guards/admin-auth.guard';
import { CurrentAdmin } from '../auth/decorators/current-admin.decorator';
import { SafeAdmin } from '../auth/auth.types';

@UseGuards(AdminAuthGuard)
@Get('api/admin/products')
list(@CurrentAdmin() admin: SafeAdmin) { ... }
```

`AuthModule` exports `AuthService` and `AdminAuthGuard`; import `AuthModule` in any module that needs them.

### Security measures in place

- bcrypt verification (`bcryptjs`, cost 12). A dummy hash is compared when the account does not exist so response time does not reveal valid usernames.
- One generic `401 Invalid credentials` message for unknown user and wrong password. `passwordHash` is never selected or returned.
- Login is rate limited to **5 attempts per 60 s per IP** (`@nestjs/throttler`, in-memory).
- Request bodies are validated and unknown fields rejected by the global `ValidationPipe`.
- CORS is restricted to the explicit origins in `ADMIN_FRONTEND_ORIGIN` (comma-separated) with `credentials: true`; there is no wildcard origin and no admin registration route.
- Cookies are `HttpOnly`, `SameSite=Lax` and `Secure` in production; session tokens are stored hashed.

### Deployment caveat: rate limiting behind a reverse proxy

The limiter keys on the client IP, which Nest reads from the socket. Behind nginx/Cloudflare every request appears to come from the proxy, so all admins share one bucket. Set Express `trust proxy` (in `src/main.ts`) to the number of proxies in front of the app, or the platform's equivalent, before deploying behind one. The limiter is also per-process: multiple instances each get their own counters.


## Admin Dashboard

A separate React + TypeScript + Vite app in `admin/` manages the product and service
catalogue. It uses the same session cookies and CSRF contract as the API — there is no
second auth system and no token is ever written to `localStorage`/`sessionStorage`.

The public website in `public/` is still served by NestJS and the admin app is built
and hosted separately. The Collections grid on the homepage now loads active products
and services from `GET /api/products` and `GET /api/services`; the six cards in
`index.html` remain as the no-JS / API-failure fallback.

Both catalogue pages support drag-and-drop ordering from a per-row handle. The new order
is saved with `PATCH /api/admin/{products|services}/reorder`; sorting is only enabled when
the whole catalogue is visible on one page (no search, category or status filter, and
sorted by `displayOrder`), so a filtered subset is never submitted as the full order.
Products and services keep independent order scales.

### Running the admin app

```bash
cd admin
npm install
npm run dev        # http://localhost:5173
```

The Vite dev server proxies `/api` and `/uploads` to `http://localhost:3000`, so start the
NestJS server first (`npm run start:dev` in the project root). If the API lives on another
origin, set `VITE_API_BASE_URL` (see `admin/.env.example`).

Production build:

```bash
cd admin
npm run build      # tsc --noEmit && vite build → admin/dist/
```

Serve `admin/dist/` from any static host, or behind the same reverse proxy as the API.
When the admin build is served from a different origin than the API, that origin must be
listed in `ADMIN_FRONTEND_ORIGIN` for credentialed CORS to work.

Sign in at `/login` with the account created by `npm run db:seed`. There is no public
registration.

### Environment variables

| Variable | Where | Default | Purpose |
|---|---|---|---|
| `DATABASE_URL` | server `.env` | — | PostgreSQL connection string (required) |
| `SESSION_TTL_HOURS` | server `.env` | `8` | Admin session lifetime, max 720 |
| `ADMIN_FRONTEND_ORIGIN` | server `.env` | `http://localhost:5173` | Comma-separated CORS allowlist for credentialed requests |
| `UPLOAD_DIR` | server `.env` | `uploads` | Directory for uploaded images (relative to the process cwd) |
| `VITE_API_BASE_URL` | `admin/.env` | empty | Absolute API origin; empty means "same origin / Vite proxy" |

`.env` files are git-ignored; only the `.env.example` files are committed.

### Image storage

Uploaded images are stored on the local filesystem, not in PostgreSQL and not in a cloud
service:

```
uploads/
├── products/<uuid>.<ext>
└── services/<uuid>.<ext>
```

- `UPLOAD_DIR` selects the root (default `uploads`, relative to the working directory).
- Files are written with a random UUID filename and the extension detected from the file
  signature. Original filenames are never used, so path traversal and executable
  extensions cannot be smuggled in.
- The database stores the public path (`imageUrl`, e.g. `/uploads/products/<uuid>.png`) and
  the stored filename (`imageFilename`). No binary data is stored in PostgreSQL.
- NestJS serves `uploads/` at `/uploads` with `index: false`, `redirect: false`,
  `dotfiles: 'deny'`, a 7-day cache, `X-Content-Type-Options: nosniff` and a restrictive
  CSP, so the directory cannot be listed or executed.

**Upload rules:** single image per request, 5 MB maximum, JPEG/PNG/WebP/AVIF only. The MIME
type and the magic bytes are both checked; SVG, HTML and executables are rejected with
`400`, and oversized files with `413`.

**Image lifecycle:**

1. The admin form uploads the new image (`POST /api/admin/uploads/{products|services}`).
2. It then creates or updates the record with the returned `imageUrl`/`imageFilename`.
3. On update, the previous file is deleted after the database write succeeds.
4. If the database write fails, the just-uploaded file is deleted again.
5. On record delete, the image file is removed after the row is gone.
6. Cleanup failures are logged and never block an edit or delete; a missing file is not an
   error.

`uploads/` is git-ignored (only `.gitkeep` is tracked). Back it up with the database.

### Catalogue API

Public (active records only):

| Endpoint | Method | Purpose |
|---|---|---|
| `/api/products` | GET | Paginated active products (`page`, `pageSize`, `search`, `category`) |
| `/api/products/:slug` | GET | One active product by slug |
| `/api/services` | GET | Paginated active services |
| `/api/services/:slug` | GET | One active service by slug |

Admin (all behind `AdminAuthGuard`; state-changing requests also need `x-csrf-token`):

| Endpoint | Method | Purpose |
|---|---|---|
| `/api/admin/products` | GET | List with `page`, `pageSize`, `search`, `category`, `isActive`, `sortBy`, `sortDir` |
| `/api/admin/products/:id` | GET | One product by UUID |
| `/api/admin/products` | POST | Create (`409` on duplicate slug, `400` on negative price) |
| `/api/admin/products/:id` | PATCH | Update |
| `/api/admin/products/:id` | DELETE | Delete record + image |
| `/api/admin/products/reorder` | PATCH | Bulk `displayOrder` update: `{ "items": [{ "id": "<uuid>", "displayOrder": 1 }] }`; atomic, `400` on duplicate ids/positions, `404` on unknown ids |
| `/api/admin/services/reorder` | PATCH | Same, for services |
| `/api/admin/services…` | — | Same shape as products |
| `/api/admin/uploads/products` | POST | Multipart `image` field; returns `{ imageUrl, imageFilename }` |
| `/api/admin/uploads/services` | POST | Same, for services |

DTOs are validated globally; unknown fields are rejected. `slug` is generated from the
name when omitted and must be unique per table.

### CORS and cookies

`src/main.ts` enables CORS only for the explicit origins in `ADMIN_FRONTEND_ORIGIN`
(comma-separated) with `credentials: true`. There is no wildcard origin, and the public
website is unaffected because it is same-origin.

- `SameSite=Lax` cookies work for `localhost:5173 → localhost:3000` and for same-site
  subdomains (e.g. `admin.example.com → api.example.com`).
- A fully cross-site admin host (different registrable domain) would need
  `SameSite=None; Secure` cookies, which means HTTPS and a considered CSRF posture. Prefer
  keeping the admin on the same site as the API.
- `NODE_ENV=production` marks cookies `Secure`, so production must be served over HTTPS.

### Persistent storage

`uploads/` must live on persistent storage:

- **Docker:** mount a named volume at the upload directory, otherwise images disappear on
  redeploy.
- **Serverless / ephemeral platforms:** the local filesystem is wiped between invocations.
  Local storage is not suitable there without a persistent volume; moving to object storage
  would be a separate change.

Uploads happen when the form is submitted, but a client that uploads and never submits can
leave an orphan file. A periodic sweep of files not referenced by any row is the fix if
that becomes a problem.

### Admin tests

```bash
cd admin
npm test           # Vitest + Testing Library
npm run build      # type-check + production build
```

The suites cover the API client (cookies, CSRF echo, 401 handling), login validation and
errors, protected routes and session restoration, list filtering/toggle/delete, and the
form upload/create/update flow. They mock the API, so no database is needed.


## Development

Prerequisites: Node.js 20.11 or newer (tested on Node 24) and a reachable PostgreSQL database.

```bash
npm install
npm run start:dev    # http://localhost:3000
```

Production build and run:

```bash
npm run build
npm run start:prod
```

Set `PORT` to change the listening port (default `3000`) and `SESSION_TTL_HOURS` to change the admin session lifetime (default `8`). `NODE_ENV=production` switches the auth cookies to `Secure`, so production must be served over HTTPS. `ADMIN_FRONTEND_ORIGIN` sets the credentialed CORS allowlist, and `UPLOAD_DIR` sets where uploaded images are written (default `uploads`).

The server resolves `public/` relative to `dist/`, so deploy `public/` alongside `dist/` (running from the project root is enough). Build and serve the admin app separately (`cd admin && npm run build`).

Run the end-to-end tests (static delivery, assets, 404s, the live database, admin authentication, product/service CRUD and image uploads):

```bash
npm test
```

The tests need a reachable database. They create temporary `__test_admin_*` accounts and temporary upload directories, delete both afterwards, and each auth test uses its own forwarded IP so rate-limit buckets do not leak between tests.

## Credits

Website developed by DigiMaraa Technologies (https://digimaraa.com)

## License

All rights reserved by Dheera Creatives and DigiMaraa Technologies.