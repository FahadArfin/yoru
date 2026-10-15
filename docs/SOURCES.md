# Research and attribution

Reviewed September 7, 2026.

Automatic anime source methodology reviewed September 12, 2026:

- [Anixo Watch implementation](https://github.com/kingbee093-hue/Anixo2f/blob/719397a358bed7187116697163490f96badb3288/src/pages/Watch.jsx) resolves metadata IDs into player routes. Yoru independently implements that method; no Anixo source code was copied.
- [MegaPlay embed API](https://megaplay.buzz/api) documents MAL, AniList and episode-ID routes. Yoru offers MAL episode links immediately, supports sub/dub, and embeds the provider using its documented ordinary cross-origin iframe. Only exact MegaPlay stream routes receive this iframe configuration; custom embeds retain their sandbox. MegaPlay routes are embed-only, so their fallback directs users to alternate choices instead of an unusable direct-open link.
- [MALSync](https://github.com/MALSync/MALSync) and its [Frieren mapping response](https://api.malsync.moe/mal/anime/52991) provide title-to-provider links. A unique AniList ID is accepted only alongside an exact MAL ID match. This uses MALSync mapping data and does not call the AniList API.
- [Anikoto API](https://anikotoapi.site/) provides recent catalog rows and series episode records. Yoru only resolves a series when its recent row matches the exact MAL ID, then verifies the series MAL ID, episode number and requested language. No title guessing or whole-catalog crawling is performed.

`GET /api/media/:id/sources?episode=1&language=sub` has the same implementation on Node and Sites. Optional directory requests have time/size limits and completed-response caches; their failure never removes the primary ID-based choice. Source IDs remain stable across directory reordering. Discovering alternatives does not replace a running default player. Providers control content, regional and language availability; these are links to try, not a promise of universal playback. Embedded providers remain independent of synchronized native room playback.

- [Anixo live site](https://anixo.online/) — visual and interaction reference. No branding, source code, or media assets copied from Anixo.
- [Supplied Anixo repository](https://github.com/kingbee093-hue/Anixo2f) — inspected its structure and licensing. The README conflicts about reuse, and no LICENSE file is present. Live rooms/chat/Discord features are not represented in the supplied repository.
- [AniList API terms](https://docs.anilist.co/guide/terms-of-use) — competing trackers are restricted. Yoru does not call the AniList API.
- [Jikan documentation](https://docs.api.jikan.moe/) — public MyAnimeList metadata, cached and rate limited. Scores, descriptions, art URLs, and other values are attributed provider snapshots.
- [Kitsu JSON:API documentation](https://kitsu.docs.apiary.io/) — metadata fallback and wide artwork. Kitsu scores are labeled as Kitsu rather than MyAnimeList ratings.
- [MyAnimeList export](https://myanimelist.net/panel.php?go=export) — user-initiated XML import. XML is validated without custom entity expansion, previewed, and applied transactionally.
- [Chrome WebMCP](https://developer.chrome.com/docs/ai/webmcp/imperative-api) and [the specification](https://webmachinelearning.github.io/webmcp/) — page-scoped tool registration and cleanup.
- [Android Trusted Web Activities](https://developer.android.com/develop/ui/views/layout/webapps/trusted-web-activities) and [Bubblewrap](https://github.com/GoogleChromeLabs/bubblewrap) — future packaging of the hosted PWA.
- [Discord OAuth2](https://discord.com/developers/docs/topics/oauth2) — authorization-code sign-in using server-side credentials.
- [DM Sans](https://github.com/googlefonts/dm-fonts) — locally served variable font under the SIL Open Font License, distributed through Fontsource.
- [MyAnimeList OAuth client implementation](https://github.com/Chris-Kode/myanimelist-api-v2/blob/master/src/Mal_Oauth/Mal_Oauth.js) — cross-check for MAL’s authorization/token endpoints and plain PKCE support. Live provider validation remains a deployment check.

Metadata artwork remains remotely served by its attributed provider and belongs to its respective owners. Publisher links in the starting catalog point to VIZ, WEBTOON, and Tappytoon. Yoru stores metadata, discussions, and account state; it does not download or host comic pages or anime video.

The native solo player derives from the user’s original FahadList project. Other application code is a new implementation. Runtime library licenses are included in their npm packages: React (MIT), React Router (MIT), Lucide (ISC), Express (MIT), Vite (MIT), and HLS.js (Apache-2.0). The Yoru application is private and is not licensed for public reuse.

The `qs` transitive dependency is overridden to 6.16.0 to include its current denial-of-service fixes while retaining Express 4 compatibility. See the [upstream security advisory](https://github.com/advisories/GHSA-x5fp-wj9c-mxmx).

## Airing schedule

Yoru uses the [AnimeSchedule v3 API](https://animeschedule.net/api/v3/documentation/anime) for episode dates. It fetches three neighboring UTC ISO weeks so a visitor's local Monday–Sunday week includes either date-line boundary. Dates and daylight-saving offsets are converted with the browser's IANA timezone; raw/broadcast, English sub, and English dub remain separate. Provider delays and missing times are retained. Cards link to the provider because timetable entries do not supply verified MAL identities.

Complete timetables are cached for 30 minutes in D1 on Sites, or under the Node data directory. Failed refreshes retain saved data and display its stale status. Unknown dates are shown only from the requested central week. Credentials and provider response errors are never returned to the browser.

### Weekly homepage

`GET /api/home?language=all|sub|dub|chinese` joins the timetable to AnimeSchedule's popularity-sorted ongoing anime page. Up to twelve banner candidates must have a dated, non-delayed airing in the current UTC week; the browser shows up to eight whose artwork meets its resolution requirements. “Hot this week” means popular anime airing that week, not measured week-over-week growth or Yoru view counts. The banner identifies AnimeSchedule as the ranking source.

The release feed shows the latest episode per title and air type in the previous seven days, newest first, up to 18 cards per filter. All is the default, combining English sub, English dub, and Chinese originals. Sub includes English-subtitled donghua; Chinese uses the provider's boolean `donghua` flag and includes original/sub releases, while English dubs remain in Dub. A subtitled release replaces the raw entry for the same episode. Future, delayed, and unknown-number/date entries are excluded. Native episode links use only exact `websites.mal` anime identities and each card's actual sub/dub air type; unmapped entries and Chinese originals without confirmed subtitles open the provider detail page. Poster images and titles come from the timetable, with verified Kitsu mappings supplying wide artwork where available. Relative times expose the visitor's local timestamp on hover. Changing the release filter preserves the current hero slide.

Timetables retain the existing 30-minute cache. Popularity is cached for six hours and title mappings/artwork for seven days, with shared refresh leases and last-good fallbacks. At most three enrichment requests run at once, using fixed hosts, bounded responses, timeouts, and no credential-forwarding redirects. Node persists these caches locally; Sites shares them in D1. The client refreshes while visible every two minutes. A failed feed is shown as unavailable rather than an empty release day. Secondary catalog shelves remain curated.

The homepage right rail uses `GET /api/home/sidebar` for upcoming anime (popularity-sorted upcoming titles, six-hour cache) and aggregate watched-library rankings. “Most viewed” counts Yoru libraries with positive anime episode progress; it does not claim verified player starts. If no watched libraries exist, the panel explicitly labels the fallback as AnimeSchedule popular picks. No member identifiers or private library records are returned. Rankings refresh on library/snapshot events and every five minutes while the page is visible.

The compact calendar uses the same timetable, local-date grouping, selected-date UTC offset, sub/dub selection, and delayed/airing labels as the full schedule. Community rows use real existing discussions and hide spoiler bodies.

### Homepage discovery tabs

The homepage switches one card grid between Just released, Most popular, and Trending. Language selection is retained when returning to Just released. The tabs support keyboard navigation, and card entrance animations respect reduced motion.

`GET /api/home/discovery?mode=popular&period=all|year|month` uses AnimeSchedule's popularity order. Last year and Last month mean anime whose first episode premiered in the previous UTC calendar year or month, with the exact period printed below the tabs. These are release cohorts, not historical view counts. The monthly query walks the corresponding season's popularity pages to find up to 18 matching premiere dates; unknown and future dates are excluded. A six-hour cache and shared refresh leases prevent repeated provider scans. Unavailable refreshes retain the matching last-good list; a different month or year never reuses the previous period's list.

`GET /api/home/discovery?mode=trending` ranks Yoru's own unique watch-page visitors within the preceding seven days. `POST /api/media/:id/view` records a visible, successfully loaded anime watch page. A random first-party HttpOnly, SameSite cookie identifies the browser; only its SHA-256 hash, the exact anime ID, and the server timestamp are stored in `watch_views`. A unique database key makes refreshes, repeat episodes, and concurrent writes idempotent for the visitor/anime pair. Revisits update the last-seen timestamp. Expired rows are removed on subsequent view writes, and all ranking queries exclude them immediately. Cookies last 30 days; separate browsers or cleared cookies can count separately. Existing origin protection and write rate limits apply. Only aggregated viewer counts are public; no account IDs, visitor tokens, or IP addresses are saved in this table.

Trending measures watch-page visits, not verified playback inside external iframes. Historical views are not fabricated or backfilled from library progress. An honest empty state is displayed until views arrive. Both SQLite and Sites D1 use the same tracking and ranking implementation. No SIMKL integration is used.

Two hero artwork overrides in `server/home-artwork.js` use the exact TMDB image URLs observed in the user's Anixo reference (2026-10-13): Heavy Knight (MAL 59741) and Apothecary Diaries season 3 (MAL 61987). These cosmetic series backdrops/logos do not determine episode data, identity mapping, or availability. Wide-art picks lead the carousel; remaining picks retain their original relative popularity order. Other titles retain existing artwork fallbacks.

### Manga discovery

`/browse/manga` opens a manga landing page with eight featured titles, New series / Most popular / Trending tabs, reader favorites, completed stories, reading-list and community links. The searchable 48-title catalog remains below; applying catalog filters opens a compact results view with a return link. Other browse categories keep their existing layout.

`GET /api/manga/discovery?mode=new|popular&period=all|year|month` uses Kitsu's manga metadata and verified `myanimelist/manga` mappings. New series is ordered by first publication date, not chapter updates. Popular uses Kitsu reader counts; Last year/month selects first-publication dates in the previous UTC calendar period. Month queries scan date-ordered pages through the entire month before ranking. Future/unknown dates, adult entries, manhwa, and missing mappings are excluded. Requests are bounded to 20 pages and 12 seconds; incomplete scans are unavailable or use the matching last-good cache. Each query is cached for six hours with shared refresh leases. Discovered titles are also saved to the catalog metadata cache. This uses Kitsu's public API, with no new credentials.

Hero art uses original Kitsu landscape images only when they pass the homepage's Full HD and crop-resolution checks. A fitted manga cover composition keeps every featured title available when landscape art is absent, too small, or fails to load. It does not stretch a poster into a full-screen backdrop.

`POST /api/media/:id/read-view` records visible loaded manga reading pages using the existing first-party viewer cookie and hashed visitor storage. `GET /api/manga/discovery?mode=trending` returns unique readers over seven days. Manga and anime ranking queries filter their ID namespace before applying the limit. Manga tracking does not imply verified reading on an external provider, and historical counts are not backfilled. Manhwa is excluded from this manga-only feed. Both backends enforce the same origin, rate-limit, and identity rules.

Provider query reference: [Kitsu MediaResource](https://github.com/hummingbird-me/kitsu-server/blob/master/app/resources/media_resource.rb) documents the year/status filters; [Kitsu API](https://kitsu.docs.apiary.io/) supplies publication dates, reader counts, mappings, and artwork.
