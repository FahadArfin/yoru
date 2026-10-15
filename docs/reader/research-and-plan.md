# Manga and manhwa reader

## Goal and evidence

The user wants MangaDex-like manga and manhwa reading inside Yoru, informed by research across GitHub. Keep the existing discovery pages and extend the journey from title to chapter to returning reader.

Reviewed 2026-10-15:

| Reference                                                    | Useful patterns                                                                        | Repository license |
| ------------------------------------------------------------ | -------------------------------------------------------------------------------------- | ------------------ |
| [Suwayomi WebUI](https://github.com/Suwayomi/Suwayomi-WebUI) | Paged/spread/webtoon layouts, scaling, chapter filters, bookmarks, per-series settings | MPL-2.0            |
| [Mihon](https://github.com/mihonapp/mihon)                   | Reading direction, categories, history, device preferences                             | Apache-2.0         |
| [Cubari](https://github.com/subject-f/cubarimoe)             | Separate chapter manifests and page rendering                                          | AGPL-3.0           |
| [Komga](https://github.com/gotson/komga)                     | Continue reading, library organization, file-backed reading                            | MIT                |
| [Kavita](https://github.com/Kareadita/Kavita)                | Continuous reading, responsive controls, collections                                   | GPL-3.0            |

These are feature references, not copied implementation. Yoru remains React with its current Node/SQLite and Sites/D1 backends. No second reader server is introduced.

Direct MangaDex inspection was blocked by the browser site-safety policy. No alternate browser, proxy, or server request is used to bypass it. Its GitHub organization exposes no current official public API documentation. Therefore this release must not claim a verified MangaDex chapter feed. Automatic catalog access is an unresolved source dependency; a clarification was sent to the user. Existing publisher links remain available. Local image files and explicitly imported page manifests can exercise the complete reader independently.

## Design

- Dedicated reading route, with a slim Yoru bar and a dark, distraction-free canvas. Desktop chapter rail; compact phone controls.
- Single page, double page, vertical, and gapless webtoon modes. Manga defaults to right-to-left single pages; manhwa to webtoon. Direction, width/height fit, reader width, background, page gaps, and keyboard hints are available in settings. Settings persist per title on this device.
- Page counter and jump, previous/next page and chapter, keyboard shortcuts, tap navigation, fullscreen, focus mode, and bounded adjacent-page prefetch. Failed pages retain a visible retry control.
- Chapter search, numeric order including decimals, volume and language filters, unread and bookmarked filters. Translation groups and alternative releases remain distinct. No generated chapter grid is presented as actual availability.
- Import a local Cubari-style JSON manifest or a chapter's image files. Image files persist in IndexedDB on this device. Imported data is local, never uploaded to Yoru. External page URLs must be public HTTPS links; manifests are bounded and plain text is never executed. A document must be explicitly associated with the current title; import is a deliberate user action.
- Local chapter/page progress, explicit read/unread state, page bookmark, and a Continue Reading shelf scoped to Manga or Manhwa. Existing account library tracking and discussions remain available. Local reading positions are clearly described as device-only.

## Implementation plan

1. Add `src/reader/model.js` for bounded manifest parsing, chapter identity/order, filtering, navigation and preference normalization; test decimal chapters, duplicate groups, malicious URLs, limits and page bounds in `tests/reader.test.mjs`.
2. Add `src/reader/storage.js` and React hooks for chapter manifests, local image blobs, progress and settings. Preserve old external reading sources. Failed writes must be surfaced, never described as saved.
3. Add `ChapterList`, `ReaderImport`, `ReaderSettings`, `ReaderCanvas` and `Reader` components. Keep provider-independent logic separate from DOM controls. Use the existing accessible modal and session library API.
4. Integrate the dedicated reader route, title chapter panel, resume action and category-specific Continue Reading shelf. Keep anime routes unchanged.
5. Run behavior tests and desktop/phone journeys with authorized local fixtures; inspect the rendered reader, empty states, keyboard/focus behavior and restored progress. Review the whole change independently.
6. Complete the existing release gates, exact-commit GitHub CI and Sites publication; verify the live UI. Report the native-reader/source-feed distinction explicitly.

## Review focus

- An imported title, language or translation group must never inherit another chapter's progress.
- Vertical scrolling and image loading must not move the reader away from the restored page.
- Storage denial, corrupt saved state, empty chapters, failures and oversized imports must remain recoverable.
- Keyboard shortcuts must not fire while entering text or using a modal.
- Manga, manhwa and anime route changes must reset state and preserve existing account/library behavior.

## Progress

- Research and source inspection complete. Source helper opened the existing version 19 checkout, baseline `a83256e5de5a455b0ab39b0db32902186c02f23b`.
- Native reader, imports, filters, local progress, settings, and discovery/title integration implemented. No new dependencies or database migration.
- Unit checks cover chapter zero/decimals, edition identity, volume order, filters, import bounds, preferences, and page bounds. Browser journeys exercise imports, persisted images, reloads, bookmarks, language selection, keyboard/modal behavior, image retry, bonus chapters, and phone/desktop resize restoration.
- Full release validation and publication are recorded in the pull request; automatic chapter-catalog access remains outside this verified implementation.
