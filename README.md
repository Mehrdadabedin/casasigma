# CasaSigma

CasaSigma Real Estate on the **Costa del Sol** (Málaga, Andalusia): **houses to visit** and
**restaurants to buy** — freeholds, leases and traspasos. One React + TypeScript codebase ships as
a web app and as a Capacitor Android app, branded with the CasaSigma logo, and the brand artwork is
stored in Postgres.

This repository contains a **working MVP with demo data**: browsing, filtering, detail pages,
house viewing requests, restaurant sale listings, and buyer/seller accounts with session-backed
sign-in. No paid service required. The catalogue covers Marbella, Estepona, Málaga, Mijas, Casares
and Nerja.

![Home page](screenshots/home.png)

## Can we build it here, for free?

Yes. Everything in the current stack is free and open source, and the machine already has what is
needed for the web app (Node 22, npm, Java 21, Android SDK, Gradle). Costs only appear later:

| Item | Cost |
| --- | --- |
| React, TypeScript, Vite, React Router | Free, MIT |
| Capacitor Android shell | Free, MIT |
| Android Studio / Android SDK | Free |
| Local development and testing | Free |
| Static hosting (Netlify / Vercel / Cloudflare Pages free tier) | Free for a demo |
| PostgreSQL (local cluster in `.pgdata`, or Supabase/Neon free tier) | Free |
| Account email login later (Supabase Auth free tier) | Free tier is enough for an MVP |
| Google Play developer account | **$25 one-time**, only when you publish |
| Apple App Store | **$99/year**, only if you add iOS later |

The only unavoidable cost in the first milestone is the Play Store fee if you want the app listed.
An APK can be installed on a phone from a file for testing at zero cost.

## Which language should we use — Python, TypeScript or React?

Short answer: **TypeScript + React for the app, and no Python for the MVP.** Add Python later only
if a specific job needs it (scraping listing feeds, price models, image processing).

| Option | Best at | Weak at | Verdict for CasaSigma |
| --- | --- | --- | --- |
| **TypeScript + React** | One codebase for web + Android WebView, typed UI, huge ecosystem, fastest iteration | Heavier runtime than plain JS; needs tooling | **Recommended.** The UI is the product; TypeScript prevents most booking/date bugs at compile time |
| Python (Django/FastAPI) | Data work, scraping, ML, scripts | Needs a separate frontend anyway; cannot run inside Capacitor | **Not as the app language.** Optional later for a recommendation/ingestion service |
| React Native | Native look on Android/iOS | Different codebase from the web app, native build complexity, slower start | Only if you later need native performance or device APIs |
| Plain HTML/CSS/JS | Zero tooling | No types, no components, painful at this feature size | Not for a product this size |

**React is a library, not a language.** React runs on JavaScript/TypeScript, so the real choice is
TypeScript vs Python. TypeScript wins here because the same code runs in the browser and inside the
Android package. A Python backend would mean building and hosting two systems before the first
feature works.

If the backend becomes data-heavy later, the natural split is: **TypeScript/React frontend +
Supabase (Postgres) or a small Python/FastAPI service for ingestion and ranking.** The frontend does
not need rewriting when that happens.

## Quick start

```bash
npm install
npm run setup      # Postgres cluster + brand images + demo accounts
npm run api        # terminal 2: API on http://127.0.0.1:8787
npm run dev        # terminal 3: http://localhost:5173
```

`npm run setup` creates two local demo accounts (`demo.buyer@casasigma.test` and
`demo.seller@casasigma.test`) and an admin with the username `admin2`. No password is stored in this
repository: set `DEMO_PASSWORD` and `ADMIN_STARTER_PASSWORD`, or leave them unset and the seed
script generates random ones and prints them once in the terminal.

The admin's first sign-in uses the starter password and lands on `/#/admin/credentials`, where you
choose your own username and password before the dashboard opens. The API refuses to keep the
password you signed in with. `npm run db:seed:users -- --reset-admin-password` gives the admin a new
starter password and signs it out everywhere. There is no Admin entry in the header or tab
bar: signing in opens `/#/admin`, and the route plus `/api/admin/*` answer `401`/`403` for everyone
else.

Browsing works without the API, but signing in and seller contact details need it. The logo falls
back to the bundled PNG in `public/brand/` when the API is down.

Other scripts:

```bash
npm run typecheck  # strict TypeScript, no emit
npm run build      # typecheck + production build into dist/
npm run preview    # serve the production build
npm run db:start   # start (or initialise) the project-local Postgres cluster
npm run db:stop    # stop it
npm run db:status  # is it running?
npm run db:seed    # copy public/brand/*.png into the media table
npm run db:seed:users  # create the demo accounts and the starter admin login
npm run api        # API (also applies db/schema.sql on boot)
npm test           # API tests (boots the API against the casasigma_test database) + web tests
npm run test:web   # web tests only (Vitest, no database needed)
```

`npm test` needs the local cluster running (`npm run db:start` also creates `casasigma_test`). To
use another database, set `TEST_DATABASE_URL`; its name must contain `test`, and the tests create
and delete their own accounts in it.

## Brand and the Postgres media store

The header wordmark is **not hard-coded**: the app requests `GET /api/media/brand-logo` and uses the
bundle only as a fallback. That keeps the brand editable in one place and gives listing photos the
same delivery path later.

| Asset | Slug | Source file |
| --- | --- | --- |
| Header wordmark (house + “CasaSigma”) | `brand-logo` | `public/brand/casasigma-wordmark.png` |
| Full lockup with “REAL ESTATE” | `brand-lockup` | `public/brand/casasigma-lockup.png` |
| Square house mark (favicon, launcher) | `brand-icon` | `public/brand/casasigma-icon.png` |

The artwork was cut from the supplied logo: white background removed, shadow band trimmed, and the
asset saved as transparent PNG so it sits on the cream page without a visible box.

**Data model** ([`db/schema.sql`](db/schema.sql)): `media(slug, mime, bytes bytea, updated_at)`, with
checks on the slug format, MIME type and an 8 MB ceiling.

**API** ([`server/index.mjs`](server/index.mjs), no framework):

| Request | Result |
| --- | --- |
| `GET /api/health` | `{ ok, db: { time, media } }` |
| `GET /api/media` | metadata for every asset (no bytes) |
| `GET /api/media/:slug` | image bytes, `ETag` + `304`, 60 s browser cache |
| `PUT /api/media/:slug` | listing photos only (`listing-` slug), needs an account with selling permission; brand assets are seed-only |

**Replace the logo:** drop the new PNG over `public/brand/casasigma-wordmark.png`, run
`npm run db:seed`, reload. The size attributes in `src/components/BrandLogo.tsx` matter for layout
stability — update them if the aspect ratio changes.

**Why a local cluster?** `scripts/pg.sh` runs Postgres 18 on port 5434 with its data in `.pgdata`
(gitignored), so nothing needs `sudo` and no system database is touched. Point `DATABASE_URL` at a
hosted Postgres when you deploy; the app code does not change.

**Trade-off, stated plainly:** images in `bytea` are ideal for a dozen brand marks and thumbnails,
and awkward for hundreds of megabytes of listing photography — that work goes to object storage
with only the URL kept in Postgres.

## Accounts and sessions

Buyers and sellers have real accounts. Passwords are hashed with Node's `scrypt`, and a sign-in
creates an opaque session whose **SHA-256 hash** is the only thing stored in Postgres. The browser
holds the raw token in an `HttpOnly`, `SameSite=Lax` cookie (`cs_session`, 30-day sliding expiry),
so no credential is reachable from JavaScript.

| Request | Purpose |
| --- | --- |
| `POST /api/auth/signup` | name, email, password, role (`buyer` or `seller`) → account + session |
| `POST /api/auth/login` | email **or** admin username + password → session; `401` is deliberately uniform |
| `POST /api/auth/admin-credentials` | signed-in admin only: current password + new username/password → replaces the starter credentials; `401` for a wrong current password, `400` for an invalid username/password, `409` for a taken username |
| `POST /api/auth/logout` | delete the session row and clear the cookie |
| `GET /api/auth/me` | the signed-in user, or `401` |

Guardrails in the API: cross-origin writes are rejected (`403`), failed logins are limited to five
per email and IP per 15 minutes (`429`), emails are unique case-insensitively, and media uploads
need an account with selling permission and a `listing-` slug so the seeded brand marks cannot be
replaced. In production, `npm run db:seed:users` refuses to create demo accounts unless
`DEMO_PASSWORD` is set.

## Admin dashboard

The admin signs in as **`admin2`** with the starter password printed by the seed script, then must
replace both username and password on `/#/admin/credentials` before `/#/admin` opens. Admins are recognised
by username, buyers and sellers by email, and one login field accepts either. The same page is the
change-password screen later on — reachable from the dashboard, with no entry in the header or tab
bar. The API is the real guard.

Sign up picks a role (`buyer` or `seller`), and that role sets two flags, `can_buy` and `can_sell`,
which every request re-reads with the session. **`/#/admin`** is the account desk on top of that: it
lists every account that signs up and lets an admin suspend or delete it.

| Action | Effect |
| --- | --- |
| Suspend | Sets `suspended_at` and deletes that account's sessions; sign-in then fails with `403 This account is suspended` |
| Reactivate | Clears `suspended_at`; the account can sign in again and keep its role |
| Delete | Removes the row for good; sessions cascade, and the email can sign up again |

| Request | Purpose |
| --- | --- |
| `GET /api/admin/users?q=` | accounts plus totals (`total`, `buyers`, `sellers`, `admins`, `suspended`); admins only |
| `PATCH /api/admin/users/:id` | `{ suspended: boolean }`; admins only |
| `DELETE /api/admin/users/:id` | permanent account deletion; admins only |

Signup-derived flags still gate behaviour: `PUT /api/media/listing-*` answers `403 selling
permission is not enabled for this account` when `can_sell` is false, and the restaurant contact
panel replaces phone and email with a “buying is turned off” notice when `can_buy` is false.
Suspension is the broader switch — a suspended account cannot sign in at all, so it can do neither.

Authorisation is server-side: these endpoints answer `401` without a session and `403` for anyone
whose role is not `admin`. The page shows a 403 card rather than pretending the area exists, and the
header nav only advertises the link to admins. Your own row and every admin row are read-only
(`409` from the API), so one bad click cannot lock every admin out. The only way to make an account
an admin today is the seed script or SQL — deliberate, to keep privilege escalation out of the UI.

## Android (Capacitor)

The native project is already generated in [`android/`](android/). After changing web code:

```bash
npm run android:sync   # build web + copy assets into the Android project
npm run android:open   # open Android Studio
```

Or from the command line with an emulator/device attached:

```bash
adb devices
npm run android:run
```

To build a debug APK without opening Android Studio (needs `ANDROID_HOME` set):

```bash
export ANDROID_HOME="$HOME/Android/Sdk"
cd android && ./gradlew assembleDebug
# android/app/build/outputs/apk/debug/app-debug.apk
```

This build was verified in this workspace: `BUILD SUCCESSFUL`, 4.2 MB debug APK containing the
current brand assets. Installing it needs an emulator or a phone with USB debugging — neither was
available here, so the APK has not been launched on a device yet.

Notes:

- The web build uses `base: './'` and `HashRouter`, so deep links work inside the Android WebView
  which serves the app from `https://localhost`.
- The app id is `app.casasigma.mobile` and the launcher label is `CasaSigma`; the id cannot change
  after the first Play upload, so decide on it now.
- The launcher icon, adaptive icon, splash screens and background colour are generated from the
  brand mark (cream `#F8F4ED` + gold house). Release signing is still open.

## What works today

- **Explore** — search entry point, curated open houses and restaurants for sale.
- **Homes** — filter by keyword, city, property type, budget; sort by price, size or rating.
- **Home detail** — facts, amenities, host card, open-house window, 7-day viewing picker.
  Booking validates name/time, blocks taken slots, and shows a confirmation.
- **Restaurants** — freeholds, leases and traspasos; filter by cuisine, city and keyword, sort by
  price or seats. The old `/tables` links redirect here.
- **Restaurant detail** — asking price, tenure, seats, hours, what comes with the room and the
  seller. Contact details unlock once a buyer signs in.
- **Accounts** — sign up as a buyer or a seller, sign in and out; the session is an `HttpOnly`
  cookie backed by Postgres, not a token in `localStorage`.
- **Admin** — the first sign-in uses the starter password and opens a credentials step to choose
  your own username and password; `/#/admin` (no menu entry) then lists every account: totals,
  search, and suspend / reactivate / delete, with an inline confirmation before deleting.
  Non-admins get a 403 card and the API refuses them.
- **Plans** — viewing requests, cancellable, persisted in `localStorage` under
  `casasigma.store.v1` (works in the Android WebView too; viewings saved under the old
  `stayfound.store.v1` key are migrated on first load).
- **Languages** — English, Spanish, Dutch and Danish across every screen. The header `EN ES NL DA`
  pill switches language, the choice persists in `localStorage`, and `<html lang>` follows it.
- **Footer** — every route ends with the brand, section links, “© 2026 CasaSigma” and a rights line.
- **Brand** — the header logo comes from Postgres through the media API, with a bundled fallback.

![Mobile homes list](screenshots/mobile-homes.png)

Demo content is deliberately small but local: 8 homes across 6 Costa del Sol towns (Marbella,
Estepona, Málaga, Mijas, Casares, Nerja) and 6 restaurants in 5 of them, three freehold and three
traspasos. Prices are in euros, agents and sellers use Spanish mobile numbers, and the listing copy
is Andalusian rather than generic. The data lives in [`src/data/`](src/data/); listing ids are stable
so bookings already saved on a device keep resolving after copy changes.

## Project structure

```
src/
  components/    Layout, footer, language switcher, brand logo, cards, pickers, artwork, icons
  data/          Seed houses and restaurants (replace with an API later)
  i18n/          Message catalogue for en / es / nl / da
  lib/           Formatting, localStorage bookings, media fetcher, auth API client
  pages/         Route-level screens, including login/signup and the admin dashboard
  state/         Language, auth session and viewing-request providers
  types.ts       Domain types shared by every screen
server/          API (Node http + pg): auth, media, no framework
scripts/         Local Postgres lifecycle, media and demo-account seeding
test/api/        API tests (node:test), each file boots its own server
test/web/        Frontend tests (Vitest + jsdom)
db/              SQL schema for media, users and sessions
public/brand/    Logo source files (also served as the offline fallback)
android/         Generated Capacitor Android project
```

## Known limitations

- Viewing requests are stored on the device only; clearing site data or reinstalling loses them.
- Seller accounts exist, but the seller studio (create a listing, upload photos, publish) is the
  next milestone — sellers currently browse like buyers and see their role in the header.
- Restaurant interest is a direct call or email after sign-in; there is no stored enquiry thread yet.
- Sessions are cookie-based and therefore not yet verified inside the Capacitor WebView.
- Slots are fictional; no availability service is contacted.
- Listing cards still use generated gradient artwork. The page headers and sign-in panels use
  credited Wikimedia Commons photography (see [`public/images/CREDITS.md`](public/images/CREDITS.md));
  seller-uploaded photography is not built yet.
- Landing copy and listing prose stay in the language the seller wrote them in; the interface is
  translated, the catalogue is not.
- Brand assets live in Postgres on this machine; the Android build has no API and therefore always
  uses the bundled copies.
- Media upload is now restricted to signed-in sellers, but there is no upload UI yet.
