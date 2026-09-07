# Hosting Yoru

Yoru is a Node.js application that serves the built React website and its API from the same origin. Accounts, sessions, saved lists, discussions, reviews, and rooms use SQLite. Run one application replica with a persistent disk. A static website host alone cannot run this application.

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

XML import and public-profile favorites import need no application credentials. The favorites flow reads Jikan’s public endpoint for the username entered by the member and requires a reviewed, session-bound import before changing the library. It depends on Jikan availability and public MAL profile data. For account connection, register a web application with [MyAnimeList](https://myanimelist.net/apiconfig) and use your public callback:

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

Members can add their own external source in the player. A host can also supply a default anime embed template using `VITE_ANIME_EMBED_TEMPLATE`; supported placeholders are `{malId}`, `{episode}`, and `{language}`. Configure only a provider you have permission to embed. This setting is public frontend configuration and must contain no secret tokens.

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

- SQLite and in-process realtime presence are designed for a single running application process. Multiple replicas require a shared database and shared event/presence service.
- External metadata providers and player/read links can be unavailable or restrict embedding. The app's catalog and community features must remain usable when an external provider fails.
- Embedding a third-party page does not guarantee synchronized playback. Rooms coordinate the supported player state and conversation; third-party iframe controls may not expose playback events.
- Yoru does not store or distribute anime video files or scanned chapters. Configure provider links only for sources you are authorized to use.
- This repository's private visibility does not make a deployed website private. Configure host access controls separately if the deployment should be limited to invited testers.

References: [Docker multistage builds](https://docs.docker.com/build/building/multi-stage/), [Playwright on CI](https://playwright.dev/docs/ci-intro), [Node.js SQLite](https://nodejs.org/api/sqlite.html).
