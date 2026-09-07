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

These tools call the same authenticated API as the UI. They cannot select another account by passing a user ID, and they do not bypass origin/session checks. Mutation descriptions identify their side effects. Public metadata and community output remain untrusted data.

Registration failures are handled without breaking navigation. Structured error output covers unauthenticated and invalid requests. Automated browser tests validate registration, search, errors, and authenticated use; the native Codex in-app browser also exposes registered tools for direct checks.
