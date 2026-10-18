# Multi-source reader implementation plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Read verified chapters from multiple sources inside Yoru, backed by Suwayomi and a bounded cache on this PC.

**Architecture:** Sites authenticates a narrow bridge API. The bridge resolves exact MAL mappings, queries private Suwayomi, and returns chapter metadata and image bytes. Its temporary tunnel registers an expiring endpoint with Sites.

**Tech Stack:** React, Node 22, Hono/Workers, D1, Docker Compose, Suwayomi, cloudflared.

**Spec:** `docs/superpowers/specs/2026-10-17-reader-sources-design.md`

## Global constraints

- Keep MAL manga IDs separate from anime; reject adult/unmatched titles.
- No public administration, arbitrary upstream URLs, browser secrets, or challenge bypasses.
- Preserve source, language, group, chapter and local reader identities.
- Keep cache local and bounded; retain existing metadata fallback when unconfigured.

## Review focus

- Chapter IDs from another title must not produce images or rating writes.
- Failed discovery must not become a fabricated empty successful catalog.
- Source changes must not show pages from the previously selected source.
- Tunnel changes and bridge restarts must recover without publishing new frontend code.
- Cached pages must not grow without bound or leak source credentials.

### Task 1: Private desktop source bridge

Files: `services/reader-bridge/{server,providers,cache}.mjs`, Dockerfile and Compose; `tests/reader-bridge.test.mjs`.

Interfaces: authenticated POST `/sources`, `/chapters`, `/chapter`, `/page`; inputs contain server-validated MAL title metadata and selected source/edition identity. Return normalized source lists, chapters, and relative page identities only.

- [ ] Add and run tests for exact matching, unsupported hosts, title ownership, authentication and cache limits; expect missing implementation to fail.
- [ ] Implement the bridge, local cache, container setup and authenticated tunnel registration.
- [ ] Run focused tests and prove live GraphQL and page fetching in Docker.

### Task 2: Sites and Node reader API

Files: `server/reading-sources.js`, `server/catalog.js`, `server/chapter-activity.js`, `sites/worker.js`; unit and Worker tests.

Interfaces: `/api/reader-bridge/register`, `/api/media/:id/reading-sources`, `/api/media/:id/chapters?source=...`, `/api/media/:id/reader/:chapter`, `/api/media/:id/reader/:chapter/page/:page`.

- [ ] Add failing tests for registration authentication/expiry, source outage, bounded proxy responses and mismatched chapters.
- [ ] Implement both backends using shared functions and existing cache storage.
- [ ] Run unit and Worker tests, preserving all existing metadata-only contracts.

### Task 3: Native reader source choices and release

Files: `src/reader/{LiveChapters,ChapterDirectory,Reader,ReaderMenu}.jsx`, a remote reader hook, browser tests, deployment/source docs.

- [ ] Add browser coverage for a remote chapter, switching sources, default language, next chapter and saved position.
- [ ] Connect chapter links to the existing reader; retain local imports and original manga/manhwa reading defaults.
- [ ] Run format, build, unit, Worker and browser suites; review the whole diff.
- [ ] Publish the validated artifact, configure the bridge secret, then verify live manga/manhwa images and cache reuse. Document startup, cache, tunnel limitations and migration steps.
