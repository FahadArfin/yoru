# Hosting Yoru

Yoru supports ChatGPT Sites (Cloudflare Workers and managed D1) and Node/Docker (one application replica with persistent SQLite). Both serve the React website and API from the same origin.

## ChatGPT Sites

The Site is registered in `.openai/hosting.json`. Reuse that project; do not create another Site for updates. Its reserved address is **https://yoru.fwad101.chatgpt.site**. Site access starts owner-only, separate from Yoru's own email/Discord account sessions. Hosted accounts and records are separate from the local SQLite preview.

```sh
npm ci
npm run build:sites
npm run test:sites
npm run test:e2e:sites
```

The build produces `dist/server/index.js`, `dist/client/`, and Sites metadata/migrations in `dist/.openai/`. The build removes the plugin's copied `.dev.vars` and rejects emitted environment files. Hosted secrets belong in Sites environment settings. Set `APP_ORIGIN` to the exact deployed HTTPS origin. The Worker derives Secure cookies from HTTPS; Node's `TRUST_PROXY`, filesystem paths, and daemon port do not apply to this deployment.

Use the Sites hosting workflow to push the exact validated source, package the output, save a version, deploy with the site's existing audience, and verify the deployment. `.openai/hosting.json` declares `d1: "DB"`; Sites provisions the real database. Wrangler's `local-only` database ID is for local development and must never be used as a production resource ID. Drizzle-generated schema migrations are applied by Sites before Worker publication. Once applied, retain migration files and their metadata unchanged; generate an additional migration for later schema changes.

Run `npm run db:migrate:local` followed by `npm run dev:sites` for a local Worker preview. D1 owns all account, library, chat, room, OAuth-state, and import-preview records. Multi-statement mutations use atomic batches with session guards. Imports use bounded JSON SQL inputs instead of thousands of individual queries. Presence uses expiring database leases; indexed event records provide replay across isolates. The Sites gateway buffers streamed response bodies, so the hosted frontend polls a cursor every 1.5 seconds after the preceding response. Each poll rechecks identity and room membership. The Node frontend retains SSE. Both transports deliver the same events; external embeds retain their existing playback limitations.

Discord and MAL use the environment variables documented below, with the deployed Site's `/api/auth/discord/callback` and `/api/mal/callback` URLs registered with the providers. They remain disabled until configured. R2 is not used by the desktop multi-source reader. Its local Docker bridge supplies and caches chapter pages; see [desktop reader host](READER-HOST.md). The hosted `READER_BRIDGE_KEY` must match the private bridge configuration, and a new Sites deployment applies that secret. Leave `READER_BRIDGE_URL` unset for automatic temporary-tunnel registration.

For releases, validate both the Sites and Node paths. The `Sites runtime, D1 concurrency, and browser journeys` CI job builds the Worker, exercises independent isolates against shared D1, and runs the existing desktop/mobile journeys. Test harness routes exist only in the local test bundle, never in the published Worker.

## Local production build

Use Node.js 22.14 or newer within the Node 22 release line. The Docker image uses Node 22.

```sh
npm ci
npm test
npm run build
npm start
```

Open `http://localhost:5184`. Development uses `npm run dev:all` and `http://localhost:5183`. Keep the API reachable only through the website's origin in production.

## Docker with persistent data

From the repository directory:

```sh
cp .env.example .env
docker compose up --detach --build
docker compose ps
```

On PowerShell, use `Copy-Item .env.example .env` for the first command. Open `http://localhost:5184`. The container health check calls `/api/health`. The application runs as an unprivileged user, and the `yoru-data` named volume persists `/app/data` across image upgrades and container recreation.

Compose binds to `127.0.0.1`, so the application is reachable on the host itself. For public hosting, add a TLS reverse proxy. Do not remove the data volume during an upgrade: `docker compose down --volumes` deletes it.

On a managed container host, build this Dockerfile, attach a persistent disk at `/app/data` writable by UID 1000, set the internal service port to `5184`, and configure `/api/health` as the health endpoint. Use one replica and disable scaling to zero if continuous live chat availability matters. Store configuration secrets in the host's environment settings, not in the repository or image.

## Public HTTPS

Set these values in `.env`, replacing the example domain:

```dotenv
APP_ORIGIN=https://yoru.example.com
TRUST_PROXY=1
COOKIE_SECURE=true
```

`APP_ORIGIN` must match the public origin exactly. `TRUST_PROXY=1` is for one trusted reverse proxy. The application port must remain private so clients cannot bypass that proxy. `COOKIE_SECURE=true` restricts session cookies to HTTPS; Compose defaults it to `false` for a local HTTP preview, so change it before public deployment. Recreate the container after changing environment values:

```sh
docker compose up --detach
```

A host-installed Caddy reverse proxy can use:

```caddyfile
yoru.example.com {
    reverse_proxy 127.0.0.1:5184 {
        flush_interval -1
    }
}
```

Point the domain's DNS at the host and allow inbound ports 80 and 443. Caddy provisions TLS. With another reverse proxy, forward the original host and protocol, disable response buffering for `/api/events`, and permit long-running responses for live room and community events. Put any CDN in front of the reverse proxy; do not cache authenticated `/api/*` responses.

## Discord sign-in

Create an application in the [Discord Developer Portal](https://discord.com/developers/applications), open **OAuth2**, and register this redirect URL with your real domain:

```text
https://yoru.example.com/api/auth/discord/callback
```

Set `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`, and `DISCORD_REDIRECT_URI` in the host environment or private `.env`. The redirect URI must exactly match the value in Discord. Recreate the container, then test sign-in and sign-out from the public HTTPS origin. A client secret belongs only on the server. Local email/password accounts work independently of Discord; an unconfigured Discord connection should not be presented as ready.

`DISCORD_INVITE_URL` optionally links the community page to your Discord server.

## MyAnimeList account connection

XML import needs no application credentials. The legacy public-profile favorites flow depends on Jikan’s discontinued public endpoint and is unavailable; Tenrai supplies catalog metadata, not user profiles. Use XML import or the official account connection. For account connection, register a web application with [MyAnimeList](https://myanimelist.net/apiconfig) and use your public callback:

```text
https://yoru.example.com/api/mal/callback
```

Set `MAL_CLIENT_ID`, `MAL_CLIENT_SECRET`, and `MAL_REDIRECT_URI` in the host’s private environment. Generate a separate encryption key locally and store its output as `MAL_TOKEN_ENCRYPTION_KEY`:

```sh
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"
```

Keep that key outside Git and back it up with the deployment secrets. Yoru encrypts MAL access and refresh tokens with AES-256-GCM, bound to the Yoru account. Replacing the key requires members to reconnect. OAuth state and PKCE are bound to the exact initiating session. Use the same host and scheme throughout sign-in and callback; for development through Vite, both `APP_ORIGIN` and callback URLs must use `http://127.0.0.1:5183`.

After restarting, sign in to Yoru, open **Settings → MyAnimeList → Connect MyAnimeList**, authorize on MAL, then choose **Sync from MAL**. The pull imports up to 5,000 anime and manga titles. It updates matching status, progress, and ratings; preserves Yoru favorites and titles not in MAL; and never writes to MAL. The UI requires an explicit sync each time. Disconnect removes Yoru’s saved tokens without deleting the library. Revoke the application in MAL too if you want provider-side authorization removed.

The automated tests simulate MAL responses, failures, token refresh, and cross-session/replayed callbacks. Finish a real connect → sync → disconnect check on the HTTPS deployment before advertising the connection as live.

## Default external anime source

Anime players work without environment configuration: the shared resolver generates MAL episode routes and adds exact directory matches. Optional provider requests are cached and bounded; unavailable directories do not suppress the primary source. Members can also add their own external source in the player. A host can supply an additional anime embed template using `VITE_ANIME_EMBED_TEMPLATE`; supported placeholders are `{malId}`, `{episode}`, and `{language}`. Configure only a provider you have permission to embed. This setting is public frontend configuration and must contain no secret tokens.

Compose passes this setting as a build argument. Run `docker compose up --detach --build` after changing it; changing a running container's environment alone cannot update built JavaScript. Manga and manhwa use the title's external reading links or a source chosen by the reader.

## Updating and backups

Before an update, make a consistent backup while the application is briefly stopped. The copy includes SQLite's database and any journal files together.

```sh
mkdir -p backups
docker compose stop yoru
docker compose cp yoru:/app/data ./backups/yoru-data-before-update
docker compose start yoru
```

Use a new destination directory for each backup; in PowerShell, create the folder with `New-Item -ItemType Directory -Force backups`. Keep a separate secure copy of deployment configuration, and move backups off the host. Backups contain private user information. Test a restore into a separate instance before depending on a backup, and preserve file ownership for UID 1000.

To update after testing:

```sh
git pull --ff-only
docker compose up --detach --build
docker compose ps
```

Check sign-in, saved lists, and a room from the public URL after an update. A successful image build does not prove the hosted site is working. If a release fails, stop the application, preserve its current data, and restore the previous image with the matching backup when schema compatibility requires it.

## GitHub automation

**Verify Yoru** runs backend tests, a production build, desktop and mobile Chromium journeys against a fresh local database, and a container startup check on pull requests and pushes to `main` or `codex/*`. Browser failure traces and screenshots are retained for seven days in the private repository's Actions artifacts. Tests use disposable fictional accounts and offline catalog data; they need no production credentials.

**Downloadable container image** runs on demand from GitHub's **Actions** tab. It runs the application checks, builds an image, and saves `yoru-image.tar.gz` as an artifact for seven days. Load a downloaded image with:

```sh
docker load --input yoru-image.tar.gz
```

These workflows do not deploy a public website, publish a public package, or require hosting credentials. Dependabot opens dependency and action updates for review. Review Actions usage limits for the GitHub plan before increasing test frequency.

## Operational boundaries

- The shared catalog uses `https://api.tenrai.org/v1` without an API key on Node and Sites. Keep the request queue, `Retry-After` handling, safe-content filters, and Kitsu fallback. Existing saved title IDs, libraries, provider attributions, and query caches are preserved; cached pages refresh through Tenrai when their six-hour lifetime expires. The public-profile favorites import is a separate legacy Jikan integration; Tenrai has no user-profile endpoints and does not restore that flow after Jikan's October 2026 shutdown. Use XML import or a configured official MAL account connection for library imports.
- Catalog browsing waits up to 12 seconds for live provider results, then explicitly labels saved fallback results. Successful query pages are reused for six hours. Sites stores fetched public title metadata and complete query pages in D1; Node retains discovered metadata and recent queries in its catalog snapshot. The catalog grows as visitors browse/search, without bulk scraping or a scheduled crawler. Curated home-page shelves remain intentionally selected.
- During provider outages, exact previously fetched pages retain their ordering and reported totals. Limited starter/cache results are labeled as saved stories and expose an immediate retry. Provider totals describe upstream metadata entries; records without a verified MAL mapping or excluded by content filters can reduce the number of visible cards.

- SQLite and in-process realtime presence are designed for a single running application process. Multiple replicas require a shared database and shared event/presence service.
- External metadata providers and player/read links can be unavailable or restrict embedding. The app's catalog and community features must remain usable when an external provider fails.
- Embedding a third-party page does not guarantee synchronized playback. Rooms coordinate the supported player state and conversation; third-party iframe controls may not expose playback events.
- Yoru does not store or distribute anime video files or scanned chapters. Configure provider links only for sources you are authorized to use.
- This repository's private visibility does not make a deployed website private. Configure host access controls separately if the deployment should be limited to invited testers.

References: [Docker multistage builds](https://docs.docker.com/build/building/multi-stage/), [Playwright on CI](https://playwright.dev/docs/ci-intro), [Node.js SQLite](https://nodejs.org/api/sqlite.html).

### AnimeSchedule token

Create an application in AnimeSchedule account settings, API tab. Copy its **application token**, not the OAuth client ID or secret. No OAuth scopes are needed for timetable requests. If the form requires a redirect URI, use your site's `/schedule` URL; this integration does not perform an OAuth redirect.

Set `ANIMESCHEDULE_API_TOKEN` as a server-only secret through native Sites environment tools and deploy a version to apply the updated environment. For local development, place the value in an ignored `.env` file, or start Node with `--env-file=.env.animeschedule`. Never use a `VITE_` prefix. Verify `/api/calendar` returns `state: ready` with current provider data; a missing or rejected token is not a valid empty schedule.
