# Release validation

Initial Yoru website, September 7, 2026.

## Local results

- Production Vite build passed. Initial application JavaScript is split from title, library, community, room, settings, and player routes; HLS loads separately.
- 36 backend/catalog/import/MAL tests passed. They cover session isolation, revocation, persistence across restart, private rooms, host handoff, votes/replies, transactional XML and public-favorites imports, query pagination, provider outages, encrypted MAL tokens, OAuth state/session binding, token refresh, and cancelled requests.
- 25 Chromium browser journeys passed across desktop and Pixel 7 profiles. One desktop run of the mobile-only keyboard test is intentionally skipped. Public-favorites provider failure is verified to leave the existing library unchanged.
- Two independent browser sessions verified shared reading chapters/chat and real play, pause, and seek on an authored synthetic WebM video.
- Stacked import/auth dialogs and mobile navigation passed focus containment, Escape dismissal, focus restoration, and scroll restoration checks.
- Native WebMCP tools were discovered through the Codex browser and used to search, inspect titles, list rooms, and open a title. Unauthenticated library reads/writes were rejected; authenticated mutations were tested through the browser adapter against the real API.
- Manual screenshots checked the original app, Anixo reference, and Yoru desktop/mobile home and title pages. Local evidence lives in `docs/audit/` and `docs/qa/` and is excluded from Git.
- `npm audit --omit=dev` reported zero known vulnerabilities. Docker Compose configuration validates.

## Remote and deployment checks

The **Verify Yoru** workflow repeats formatting, backend, build, and browser checks, then builds and starts the production Docker image. Consult the private repository’s Actions tab for the exact commit result. The local Docker daemon was unavailable, so local image execution is not claimed.

Discord and MAL OAuth need real application credentials and a matching callback origin. Controlled tests do not prove a live provider authorization. External media availability and embedding policies also require checking each selected provider.

This release includes a hostable website and PWA assets. The Sites edition adds an owner-only HTTPS deployment; it does not include a built APK/AAB. Public rollout also needs operational decisions for moderation, account recovery, backups, and who may register.

## Sites edition

The native Worker and generated D1 schema preserve the same frontend/API contract. Cross-isolate tests cover session ownership, atomic partial library updates, comments/votes/reviews, live presence deduplication, chat replay, private invitation isolation, final-seat join races, versioned host updates, and host transfer without rewinding playing video. Database data survives both Worker restarts.

Live Sites verification confirmed D1-backed APIs, access checks, exact JavaScript/CSS bytes, and a successful provider-backed metadata search. A timed stream probe found that the Sites gateway buffered SSE bodies until completion. The hosted frontend therefore uses immediate JSON cursor polling, preserving burst messages and rechecking private membership; the Node frontend continues to use SSE.

Browser recovery checks simulate a failed configuration request, change a library before the live connection opens, and verify that reconnect snapshots reconcile the saved list. Hosted polling also notices logout in another tab and clears the previous account state.

The import suite commits 5,000 titles with a set-based query, injects a failure at the last title, and verifies rollback of every earlier update. Provider fixtures exercise public-favorites preview on one Worker and commit on the other, single-use OAuth callback claims, encrypted tokens, MAL sync, provider failures, and cancellation/logout during network requests. These fixtures never contact a real provider account.

GitHub Actions validates Node/Docker and Sites in separate jobs. Production credentials, third-party media availability, and actual provider authorization remain distinct from controlled test results. No local environment files, session records, test users, or database contents are included in the deployment artifact.
