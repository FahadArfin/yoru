# Working on Yoru

- This is the new private Yoru repository. The original `../fahads-anime-manga-list` checkout and its data are separate.
- Use Node 22.14+ (Node 22 in CI/containers) and `npm.cmd` on Windows if PowerShell blocks `npm`.
- `npm run dev:all` uses frontend 5183 and API 5184. The production Node server serves `dist/` and `/api` from one origin after `npm run build`.
- The Node backend uses SQLite and in-process SSE, requiring one server instance with persistent `data/` storage. The Sites backend uses managed D1 and shared event/presence records across Workers. Keep session ownership on the server; never accept a client-selected account ID for writes.
- Keep `.env`, OAuth credentials, encryption keys, databases, and runtime data out of Git. Build-time `VITE_*` values are public.
- Read `docs/DEPLOYMENT.md` for hosting and OAuth setup, `docs/SOURCES.md` for source restrictions, and `docs/WEBMCP.md` for page tools.
- Native video/HLS supports synchronized room playback. Generic embeds do not expose synchronized controls. Preserve that distinction in the UI.
- Preserve anime and manga as separate ID namespaces. Manhwa is a manga subtype; do not pass MAL IDs to AniList or apply anime embeds to reading routes.
- Before publishing changes, run `npm run format:check`, `npm run check`, and relevant `npm run test:e2e` journeys. Browser tests use disposable databases and block external media/OAuth requests.
- Sites releases also require `npm run build:sites`, `npm run test:sites`, and `npm run test:e2e:sites`. Use the existing `.openai/hosting.json` project, preserve applied Drizzle migrations, and never publish copied environment files or test harness routes. The owning agent handles Sites checkout edits and deployment.
- Verify GitHub Actions for the pushed commit. A green build does not establish live OAuth, third-party playback, an APK, or public deployment.
