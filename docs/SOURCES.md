# Research and attribution

Reviewed September 7, 2026.

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
