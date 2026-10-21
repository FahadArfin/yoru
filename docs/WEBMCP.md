# WebMCP

Yoru registers page-scoped imperative tools through `document.modelContext.registerTool`, with AbortSignal cleanup. It also tolerates the older navigator-based registry. Browsers without WebMCP continue to use the ordinary UI. The current API is experimental; see [Chrome’s imperative API](https://developer.chrome.com/docs/ai/webmcp/imperative-api).

| Tool                  | Behavior                                                               |
| --------------------- | ---------------------------------------------------------------------- |
| `yoru_search_catalog` | Search eligible anime/manga/manhwa and enabled native reading catalogs |
| `yoru_get_title`      | Read a title and provider links                                        |
| `yoru_get_library`    | Read the current session’s personal library                            |
| `yoru_update_library` | Save requested favorite/status/progress changes under that session     |
| `yoru_list_rooms`     | Read rooms visible to the session                                      |
| `yoru_open_title`     | Navigate to a title page                                               |
| `yoru_get_sources`    | Discover anime episode sources for a MAL ID, episode and sub/dub       |
| `yoru_open_episode`   | Open a validated episode with a discovered source                      |
| `yoru_get_page_state` | Read the current page, selected source and active session              |
| `yoru_select_source`  | Choose a source listed on the current watch page                       |

These tools call the same authenticated API as the UI. They cannot select another account by passing a user ID, and they do not bypass origin/session checks. Mutation descriptions identify their side effects. Public metadata and community output remain untrusted data.

General title/library/navigation tools accept the shared media-reference namespace: `mal-anime-*`, `mal-manga-*` and stable `ext-manga-<32 lowercase hex>` provider-native manga IDs returned by Yoru. Native results preserve additive `sourceRef`, canonical `upstreamRef`, classification/provenance and destination fields where supplied by the same public API. A native record retains null MAL IDs; tools do not manufacture a MAL match. Existing tool names are unchanged. Anime episode/source tools retain a strict `mal-anime-*` schema and reject both manga namespaces before transport.

Every execution reads the current `useReaderSelection` controller through the Shell's stable reference. Content tools wait for current readiness and Ara confirmation, then propagate the complete context, including owner scope, destination, integration mode, selection fingerprint, guest lease expiry and cancellation signal. Read requests use the shared `readerRequest` transport. Library writes use the same current destination/context and existing session-authorized endpoint. Tool arguments cannot override account owner or destination. An unknown identity reads public defaults with cookies omitted and personal ratings removed; personal mutations require the existing account session. A context switch or expired guest lease prevents stale results from being returned into the new scope.

`yoru_search_catalog` keeps `query` and `category` arguments. Manga/manhwa use the bounded reader feed, preserving continuation/source states and unknown totals. `ALL` adds the existing anime metadata search without guessing cross-provider equivalence or comparable popularity. Use the current UI selector to choose **All sources** (`all`), **MangaDex + Weeb Central** (`core`) or **Suwayomi extensions** (`extensions`). Native titles are discoverable only while generic support is enabled server-side and their provider/title is eligible. A title/provider capability or card does not guarantee upstream reading availability.

Optional reading search arguments are `sourceId` (an exact dedicated/generic source ID), `language` (the source language token) and `cursor` (the opaque `nextCursor`, at most 2 KiB). Generic IDs preserve canonical nonzero signed 64-bit decimal strings, including negative IDs; zero, leading zeros, overflow and numeric coercion are rejected. Pass the same query/filters and current selection to continue; the server rejects expired or account/destination/selection-mismatched cursors with restart-required state. Reading-only filters are rejected for `category: "ANIME"`. `ALL` includes anime metadata on its initial unfiltered request; reading continuation pages do not repeat that first anime page. A filtered-empty page with continuation still needs another request.

Registration failures are handled without breaking navigation. Structured error output covers unauthenticated and invalid requests. Automated browser tests validate registration, search, errors, and authenticated use; the native Codex in-app browser also exposes registered tools for direct checks.

Settings reports actual registration counts and failures. Both registration lifecycle and per-execution cancellation signals are honored. Navigation tools wait for the visible page state; changing source does not mark an episode complete. Library updates refresh the visible account state. Returned external links and provider-managed availability do not imply that playback started. No tools are delegated to third-party player frames.

Example flow: search for a title, pass its `mal-anime-*` ID to `yoru_get_sources` with `episode: 1` and `language: "sub"`, then call `yoru_open_episode` with a returned `sourceId`. Use `yoru_get_page_state` to confirm selection. `yoru_select_source` rejects arbitrary URLs and unlisted IDs. Anime source tools reject manga/manhwa namespaces.

The native manga/manhwa reader exposes its title, category, chapter number and edition language through the existing page-state tool. It reports no video sources and no playback control support. Device-local page files, bookmarks and chapter imports are not exposed through WebMCP tools.

Account library and rooms are filtered for the current destination by the server before pagination. Exact reading choices retain their native media/source/edition identity when a browse mode changes. Unsupported MAL sync remains unavailable for provider-only records; private library export retains null MAL IDs and explicit destination labels, while MAL XML import format is unchanged. Existing AnimeSchedule/MangaDex release feeds remain authoritative; these tools add no inferred extension calendar dates.

See the [acceptance record](qa/enabled-reader-catalogs-acceptance.md) for actual unit, browser, Worker and live evidence. Synthetic tool registries exercise Yoru's adapter, not native browser WebMCP availability or a real provider. Pending integrated checks and release probes remain explicit.
