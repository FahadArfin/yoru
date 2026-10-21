# Yoru accounts and ChatGPT sign-in

Both email/password and ChatGPT sign-in resolve to the existing `users.id`. All ownership and write authorization continue to use the server's Yoru session. Browsers cannot select an account by supplying a user ID.

## Supported platform integration

The Sites identity reference shipped with the Sites plugin documents optional `oai-authenticated-user-id` and `oai-authenticated-user-email` headers on public Sites. The ID is stable within this Site. Dispatch owns `/signin-with-chatgpt`, `/signout-with-chatgpt`, and `/callback`; sign-in uses top-level navigation. No Google/Facebook app or separate OpenAI client secret is required.

Only the Sites Worker uses these gateway headers, only in the explicit sign-in completion route after a cookie-bound, expiring, single-use state. The ordinary `/api/auth/me` endpoint does not automatically create accounts from headers. The Node server ignores them and advertises ChatGPT sign-in as unavailable. A self-hosted Worker must not expose this integration without the trusted Sites gateway in front of it.

ChatGPT-only accounts get a neutral public display name, editable in Settings. The provider subject stays server-side. Email is an account contact field and is not a public author name. Authentication grants no access to ChatGPT conversations, connected apps, or paid model usage.

## Existing members

Sign in with the existing Yoru credentials, then choose **Settings → Connect ChatGPT**. This starts a same-origin POST and binds the linking state to the exact existing session and user. Completion rechecks that session inside the write transaction. The account ID and every existing foreign-key record remain unchanged.

Never merge accounts by matching email. A new ChatGPT sign-in whose email is already registered asks the visitor to sign in with the existing password and connect explicitly. An identity already attached to another user cannot be attached again; replacing an existing connection is rejected. Automatic merging and unlinking are not included.

ChatGPT sign-in creates the same revocable 30-day Yoru session as email/password. Signing out revokes that Yoru session first, then navigates through the platform sign-out path for sessions created through ChatGPT. Email/password sign-out remains local to Yoru. Return paths are restricted to same-origin application pages. A session changed during linking invalidates the operation.

## Saved activity inventory

| Activity                                                                                          | Durable ownership / behavior                                                                                           |
| ------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Library, planned/watching/reading/completed/paused/dropped status, favorites, progress and scores | `library`, by Yoru user ID and canonical media ID                                                                      |
| Continue watching / reading                                                                       | `resume_progress`: latest episode or chapter edition, page, language, native video position, and update time per title |
| Chapter bookmarks and read/unread markers                                                         | `reader_markers`, by user, title and edition; bookmark removal and unread changes persist too                          |
| Reviews and ratings                                                                               | `reviews`, by author and title; one editable review per member/title                                                   |
| Title, episode and chapter discussions, replies                                                   | `comments`, with author, title, unit or edition, parent, spoiler flag and timestamp                                    |
| Likes/dislikes on comments                                                                        | `comment_votes`, signed value and user; one current vote per comment/user                                              |
| Chapter ratings                                                                                   | `chapter_ratings`, by user/title/edition                                                                               |
| Reader catalog overrides                                                                          | Existing account catalog preferences, retaining Yoru/Ara Ara destination choices                                       |
| Forum topics/replies, public channel messages, room messages                                      | Existing authored records retain the same user ID across login methods                                                 |
| MAL connection/imported lists                                                                     | Existing user-scoped connection and library records, unchanged by linking                                              |

Private library and reading records are returned only for the authenticated member and retain existing catalog/destination authorization. Comments, reviews and public chat are public as before. Personal API responses use `Cache-Control: no-store`. The application does not infer completed viewing from an external embedded player: such players expose only the selected episode, not actual playback time. Completion status is a deliberate library or chapter action. Resume history records the latest position per title, not an exhaustive click-by-click browsing log.

Chapter markers were previously device-only. On opening a title while signed in, existing markers under that same account's device namespace are queued for upload. Guest data is not silently attributed to a newly signed-in account. Pending changes survive reload and retry while that title is open, on reconnect/focus and every 30 seconds. Each field has its own timestamp so a bookmark edit cannot erase an unrelated read-status change. Delayed responses cannot be applied to a different account. Imported files and images never upload; device appearance and reader layout remain local.

## Validation

The disposable two-Worker/D1 tests simulate trusted gateway identity and cover stable subjects, cross-session history, explicit linking, duplicate emails, conflicting links, single-use/expired state, missing identity/cookies, safe return URLs, logout revocation, and account isolation. Node tests ensure forged platform headers cannot authenticate. Browser journeys cover the button alongside manual sign-in, same-account return in a fresh browser, display-name editing, platform logout, and bookmarks across devices. Simulated gateway tests do not claim to exercise the external ChatGPT consent screen.

Research: [OWASP Authentication](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html), [OWASP Authorization](https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html), [MDN Cache-Control](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Cache-Control), and the installed Sites `references/identity-and-secrets.md` and `templates/vinext-starter/app/chatgpt-auth.ts`.
