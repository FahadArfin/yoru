# WebMCP

Yoru registers page-scoped imperative tools through `document.modelContext.registerTool`, with AbortSignal cleanup. It also tolerates the older navigator-based registry. Browsers without WebMCP continue to use the ordinary UI. The current API is experimental; see [Chrome’s imperative API](https://developer.chrome.com/docs/ai/webmcp/imperative-api).

| Tool                  | Behavior                                                           |
| --------------------- | ------------------------------------------------------------------ |
| `yoru_search_catalog` | Search public anime/manga/manhwa metadata                          |
| `yoru_get_title`      | Read a title and provider links                                    |
| `yoru_get_library`    | Read the current session’s personal library                        |
| `yoru_update_library` | Save requested favorite/status/progress changes under that session |
| `yoru_list_rooms`     | Read rooms visible to the session                                  |
| `yoru_open_title`     | Navigate to a title page                                           |
| `yoru_get_sources`    | Discover anime episode sources for a MAL ID, episode and sub/dub   |
| `yoru_open_episode`   | Open a validated episode with a discovered source                  |
| `yoru_get_page_state` | Read the current page, selected source and active session          |
| `yoru_select_source`  | Choose a source listed on the current watch page                   |

These tools call the same authenticated API as the UI. They cannot select another account by passing a user ID, and they do not bypass origin/session checks. Mutation descriptions identify their side effects. Public metadata and community output remain untrusted data.

Registration failures are handled without breaking navigation. Structured error output covers unauthenticated and invalid requests. Automated browser tests validate registration, search, errors, and authenticated use; the native Codex in-app browser also exposes registered tools for direct checks.

Settings reports actual registration counts and failures. Both registration lifecycle and per-execution cancellation signals are honored. Navigation tools wait for the visible page state; changing source does not mark an episode complete. Library updates refresh the visible account state. Returned external links and provider-managed availability do not imply that playback started. No tools are delegated to third-party player frames.

Example flow: search for a title, pass its `mal-anime-*` ID to `yoru_get_sources` with `episode: 1` and `language: "sub"`, then call `yoru_open_episode` with a returned `sourceId`. Use `yoru_get_page_state` to confirm selection. `yoru_select_source` rejects arbitrary URLs and unlisted IDs. Anime source tools reject manga/manhwa namespaces.
