# Release validation

Initial Yoru website, September 7, 2026.

## Local results

- Production Vite build passed. Initial application JavaScript is split from title, library, community, room, settings, and player routes; HLS loads separately.
- 36 backend/catalog/import/MAL tests passed. They cover session isolation, revocation, persistence across restart, private rooms, host handoff, votes/replies, transactional XML and public-favorites imports, query pagination, provider outages, encrypted MAL tokens, OAuth state/session binding, token refresh, and cancelled requests.
- 23 Chromium browser journeys passed across desktop and Pixel 7 profiles. One desktop run of the mobile-only keyboard test is intentionally skipped. Public-favorites provider failure is verified to leave the existing library unchanged.
- Two independent browser sessions verified shared reading chapters/chat and real play, pause, and seek on an authored synthetic WebM video.
- Stacked import/auth dialogs and mobile navigation passed focus containment, Escape dismissal, focus restoration, and scroll restoration checks.
- Native WebMCP tools were discovered through the Codex browser and used to search, inspect titles, list rooms, and open a title. Unauthenticated library reads/writes were rejected; authenticated mutations were tested through the browser adapter against the real API.
- Manual screenshots checked the original app, Anixo reference, and Yoru desktop/mobile home and title pages. Local evidence lives in `docs/audit/` and `docs/qa/` and is excluded from Git.
- `npm audit --omit=dev` reported zero known vulnerabilities. Docker Compose configuration validates.

## Remote and deployment checks

The **Verify Yoru** workflow repeats formatting, backend, build, and browser checks, then builds and starts the production Docker image. Consult the private repository’s Actions tab for the exact commit result. The local Docker daemon was unavailable, so local image execution is not claimed.

Discord and MAL OAuth need real application credentials and a matching callback origin. Controlled tests do not prove a live provider authorization. External media availability and embedding policies also require checking each selected provider.

This release includes a hostable website and PWA assets. It has not been published to a public HTTPS domain and does not include a built APK/AAB. Public rollout also needs operational decisions for moderation, account recovery, backups, and who may register.
