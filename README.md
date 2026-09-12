# Yoru

An anime, manga, and manhwa home for discovering stories, keeping your place, and enjoying them together.

Yoru is a new, private application rebuilt from the useful parts of Fahad’s Anime & Manga List. The old repository and its data remain separate. Anixo informed the experience, but no Anixo code or assets were copied: its repository’s licensing language conflicts and its live social features are not included in that source tree.

## Run it

Use Node.js 22.14 or newer. On Windows, use `npm.cmd` if PowerShell blocks `npm`.

```sh
npm ci
npm run dev:all
```

Open **http://127.0.0.1:5183**. Register your own account through **Sign in → Create an account**. There are no seeded members, fake online counts, or shared profile selectors.

```sh
npm run build
npm start
```

The production server opens at **http://localhost:5184** and serves both the website and API. Account data persists in `data/yoru.sqlite`. Yoru also runs on **ChatGPT Sites**, with a Cloudflare Worker and managed D1 database. Both deployment options share the same React interface and metadata/import logic; see [hosting instructions](docs/DEPLOYMENT.md).

## Implemented

- Responsive dark interface, cinematic featured artwork, anime/manga/manhwa shelves, search, genre filters, title pages, and URL-based navigation.
- Public Jikan/MyAnimeList metadata with Kitsu fallback, request deduplication, persistent caching, and 43 verified starting titles. The catalog extends through live search; cached metadata remains usable during provider outages. Ratings carry their provider attribution.
- Personal accounts with scrypt password hashes and opaque, hashed, HttpOnly cookie sessions. The API derives all ownership from the session. Discord OAuth is implemented and appears when configured.
- A per-account library with favorites, reading/watching status, progress, export, and MAL XML import with a review step and transactional writes. Public MAL favorites can be previewed and imported separately through Jikan. Optional MAL OAuth connects an account for a manual pull of statuses, progress, and scores. Tokens are encrypted at rest; existing favorites survive imports and syncs.
- Whole-title reviews separated from episode/chapter discussions, nested replies, spoiler reveal, and one reversible vote per account.
- Real online presence, community activity, and persistent live chat over server-sent events.
- Public or invite-only watch/read rooms, member limits, room chat, host controls, shared episode/chapter, private source protection, and host handoff. Direct video/HLS playback synchronizes; ordinary third-party frames and external readers run independently with shared room context.
- External video/HLS/iframe/provider links and verified publisher reading links. Yoru does not host videos or comic pages. Sources supplied through the player and playback timestamps are saved on that device; library progress is saved to the account.
- PWA manifest, application icons, service worker offline screen, reduced motion, keyboard navigation, and native WebMCP integration.
- API, catalog/import, and desktop/mobile browser tests in GitHub Actions, plus Docker build/start verification and an optional downloadable image artifact.

## Connections and scope

**Discord:** set `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`, and `DISCORD_REDIRECT_URI` using the deployment guide. No Discord credentials are included. Email/password works without Discord. `DISCORD_INVITE_URL` links the community to your own server.

**MyAnimeList:** XML import works without credentials. **My library → Import MAL favorites** reads a public profile through Jikan, then lets you review and add its anime/manga favorites. Existing list progress and ratings remain unchanged. Optional OAuth connection and manual one-way synchronization are implemented: configure the four `MAL_*` values, connect through **Settings → MyAnimeList**, then choose **Sync from MAL**. This updates matching statuses, progress, and scores in Yoru; existing favorites and titles absent from MAL remain. Nothing is written back to MAL. The OAuth protocol is covered with controlled provider fixtures; a real MAL account connection still requires deployment credentials and live verification.

**Media providers:** anime episodes automatically offer a MegaPlay player from their MAL ID, with sub/dub selection, exact MALSync alternate mappings and available Anikoto episode matches. Provider links appear alongside the player. Users can still add a source, and hosts can optionally configure `VITE_ANIME_EMBED_TEMPLATE`. Manga/manhwa retain their reading links. The app distinguishes native synchronized playback from unsynchronized embeds. Provider availability, geographic restrictions, and embedding policies are external to Yoru.

**Hosting:** ChatGPT Sites uses `sites/worker.js` and persistent D1 records for accounts, lists, conversations, shared presence, and room state. The Node/Docker option uses one process and a persistent SQLite volume. Both require HTTPS and an exact `APP_ORIGIN`. The Sites publication starts owner-only. Moderation, email verification, and password recovery remain future work before broad open registration.

**Android:** this release is an installable website. APK/AAB packaging is a later release after choosing the permanent HTTPS domain; see [Android delivery](docs/ANDROID.md).

## Checks

```sh
npm run check
npx playwright install chromium
npm run test:e2e
```

Browser tests use a separate temporary database and offline metadata. They cover accounts, library persistence and isolation, MAL import, discussions/reviews, two-user reading rooms, synthetic-video play/pause/seek synchronization, and WebMCP. They do not rely on real third-party streams or publish messages to any external community.

For the Sites backend, run `npm run build:sites`, `npm run test:sites`, and `npm run test:e2e:sites`. These exercise the actual Workers runtime, two independent isolates sharing D1, concurrent room joins, OAuth cancellation, event replay, and persistent records after restart. GitHub Actions runs both hosting variants.

## Code map

| Area                            | Location                                                 |
| ------------------------------- | -------------------------------------------------------- |
| App shell and navigation        | `src/main.jsx`                                           |
| Pages and shared UI             | `src/pages/`, `src/components.jsx`, `src/styles.css`     |
| Data fetching and account state | `src/api.js`, `src/state.jsx`                            |
| Discussions, chat, playback     | `src/Discussion.jsx`, `src/Chat.jsx`, `src/Playback.jsx` |
| Browser agent tools             | `src/webmcp.js`                                          |
| Server and authentication       | `server/index.js`, `server/auth.js`                      |
| Normalized database             | `server/db.js`                                           |
| Social and room behavior        | `server/social.js`                                       |
| Metadata and MAL import/sync    | `server/catalog.js`, `server/import.js`, `server/mal.js` |

See [the original-app audit and design decisions](docs/AUDIT.md), [WebMCP tools](docs/WEBMCP.md), and [third-party sources](docs/SOURCES.md).
