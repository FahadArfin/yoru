# Enabled reader catalogs across Yoru and Ara Ara

Date: 2026-10-18 (America/New_York)

Status: implementation specification for user review. The integration approach is approved; this document does not authorize starting product implementation before its review.

## 1. Outcome and approved scope

Make the enabled Suwayomi extension catalogs useful for discovery and native reading throughout Yoru and Ara Ara. Their titles must appear in browsing, search and reading discovery shelves; opening a title must lead to its details, real chapter editions and readable pages where the extension supports those operations. Provider-only titles must work without a MyAnimeList entry.

Keep the existing MangaDex and dedicated Weeb Central integration alongside the new generic extension integration. Provide a user-facing selector between the integrations, with both available together by default. Keep the shared catalog assignments released in version 106, personal account overrides, guest browser overrides and reset behavior.

This approved extension scope supersedes the earlier small additional-source allowlist in `2026-10-17-reader-sources-design.md`. It also expands Ara Ara from its current reviewed non-explicit editorial list to the selected extension catalogs, including their adult material inside the existing gated space. Preserve the editorial list as a shelf, not as the complete membership list. Update `docs/ARA_ARA.md`, relevant source-policy documentation and UI copy to describe this new scope accurately; Yoru's non-explicit policy does not expand.

Preserve existing URLs, saved titles, imported chapters, progress, bookmarks, comments and rooms. Extend the current product rather than creating a separate reader application. Anime remains on its current catalog and playback paths.

Availability means an adapter can perform the requested operation now, not merely that its extension is installed. No implementation can guarantee third-party uptime or make a provider expose operations it does not support.

## 2. Current implementation and necessary changes

The existing checkout is `yoru-multisource`, linked to `FahadArfin/yoru`. The existing Sites project and production URL remain unchanged.

| Current boundary                                                                                                                 | Required extension                                                                                                                                        |
| -------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `shared/catalog-preferences.js` defines 21 provider memberships for Yoru/Ara Ara; Settings discovers installed language editions | Reuse these memberships as the default for real discovery and reader requests, not only UI filtering                                                      |
| `services/reader-bridge/providers.mjs` implements MangaDex and a dedicated Weeb Central adapter                                  | Preserve both; add a separate generic Suwayomi extension adapter                                                                                          |
| `shared/reader-connection.js` lists sources and browses Suwayomi's already-indexed `mangas`                                      | Fetch remote extension popular/search/latest results through supported Suwayomi operations; an indexed library query is not remote catalog discovery      |
| `server/reading-sources.js` and the bridge accept non-adult `mal-manga-*` titles and two reader source identifiers               | Resolve provider-native titles and editions through validated stored references and an explicit destination policy                                        |
| Ara Ara uses a finite reviewed MAL collection and `collectionView` filters against that list                                     | Retain reviewed entries as editorial content while adding eligible extension titles; remove the reviewed-list-only assumption from generic catalog routes |
| Client requests infer MangaDex/Weeb Central from chapter ID formats                                                              | Use explicit integration, source and edition identity for new records; retain legacy parsers for existing links                                           |
| Library, resume, discussion, room and WebMCP validation assume MAL identities in several places                                  | Introduce one shared media-reference contract and update its consumers consistently                                                                       |

## 3. Coexisting integrations and selector

Use a three-option **Catalog integration** selector:

| UI label                | Stored value | Behavior                                                                                                                            |
| ----------------------- | ------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| All sources             | `all`        | Existing metadata discovery and core adapters, plus eligible enabled extension catalogs; default for each section                   |
| MangaDex + Weeb Central | `core`       | Preserve the existing discovery experience and dedicated chapter adapters; no generic extension discovery requests                  |
| Suwayomi extensions     | `extensions` | Discovery and available editions from enabled installed extension catalogs; no metadata-only results presented as extension matches |

Place the selector on manga/manhwa browsing and search results, title chapter-source controls and the reader source menu. Settings exposes the same preference with concise help. Show the provider, language and integration on choices where needed to distinguish editions. Use the same control/state model rather than independent switches with conflicting effects.

Store the selected mode separately for Yoru and Ara Ara. Signed-in users sync it through their account; guests keep it in their browser. Missing or invalid values resolve to `all`. The existing **Reset to site defaults** is a global personal-preference reset: it restores catalog assignments and both destinations' integration modes to `all`. A temporary URL filter may override the saved mode for browsing; resolving that filter does not write account settings. Shared links include their destination and explicit source/edition identity.

The selector is a discovery/source filter, not a replacement for provider membership or content eligibility. Switching to `core` must not re-enable MangaDex or Weeb Central if the visitor disabled that provider in the current section. Switching to `extensions` must not enable every installed extension. Disabled and unsupported choices have an explanation and a route back to Settings.

### 3.1 Preserve the existing adapters

The current MangaDex adapter uses MangaDex's API. The dedicated Weeb Central adapter already uses Suwayomi internally with exact MALSync matching; it is not an independent server. Both native reading paths currently depend on the bridge for page delivery, while MangaDex has an existing metadata/external-reading fallback. Preserve these distinctions. A group toggle cannot make Weeb Central independent of Docker or guarantee native reading when the PC sleeps.

Do not rewrite or replace the core adapters with generic extension calls. They remain independently selectable even if a generic extension for the same provider is broken. Generic extensions for MangaDex or Weeb Central may be available in `extensions` mode if installed and capable. Their integration/source identities stay distinct from the dedicated adapters, while the provider's membership switches apply to both.

In `all`, merge verified matching title cards and group their source choices; prefer the existing dedicated adapter for an existing core title unless the user has explicitly selected another edition. Do not duplicate a provider/language catalog in the discovery chooser merely because two adapter paths can reach it. Retain both verified adapter paths as explicit integration choices even when they reach the same upstream edition: deduplicate the card/edition presentation, not the available integrations. Different editions remain separate rows with integration labels. Only verified exact chapter equivalence may preserve chapter selection when changing paths; page progress stays attached to its original edition reference and is not copied speculatively.

### 3.2 Reading and mode changes

An explicit chapter link or saved edition stays pinned to its integration/source/chapter. A different saved browsing mode must not silently substitute another provider's chapter. Show that the opened edition belongs to the other integration and offer a deliberate switch. Disabled provider memberships and destination eligibility still apply.

When the user changes the integration in an open reader, retain the current page and progress until they choose an eligible replacement edition. Offer only verified editions of that title in the chosen group. If none exist, explain that result and allow restoring the previous group. Never equate unrelated chapter numbers as an identity match. Preserve progress for every previously opened edition.

## 4. Architecture and responsibilities

Keep three existing boundaries:

1. **Browser:** presentation, preference controls, user interaction, local imports and bounded preloading. It receives public normalized records and opaque references, never Suwayomi credentials or administration access.
2. **Yoru Node/Sites API:** identity resolution, current account preferences, effective source eligibility, destination policy, normalized catalog aggregation, persistence and same-origin reader URLs. Node SQLite and Sites D1 implement the same contracts.
3. **Private Docker bridge:** fixed operations for installed source capabilities, remote browsing/search, details, chapters and images. It translates validated source references into bounded Suwayomi calls and caches fetched metadata/pages. The existing core adapter module remains separate from the generic extension adapter.

Add focused modules for provider/media reference validation, generic extension operations, normalized catalog storage, aggregation and destination eligibility. Route handlers call those modules; they do not grow another monolithic provider implementation inside `providers.mjs` or duplicate policy in React.

The bridge remains authenticated using the existing secret and expiring tunnel registration. Do not expose raw GraphQL, arbitrary URL fetching, extension administration, installed-account cookies, the Docker socket or the host's personal indexed library. Remote discovery may cause Suwayomi to index titles as its normal operation; public discovery responses must come from the requested provider feed, not from a dump of all indexed records.

## 5. Provider capabilities and discovery

Represent each installed source using its exact Suwayomi source ID as a decimal string, provider preference grouping key, language and supported capabilities: popular, latest, search, details, chapters and pages. Never convert 64-bit source IDs to JavaScript numbers. Keep display-name membership compatibility, with explicit provider grouping/aliases when an extension's name changes; an unknown provider remains disabled by default.

Preserve source and title classification fields and their provenance in the normalized contract; current catalog discovery discards `isNsfw`/`contentWarning`, which must change before these sources feed discovery. Page source discovery explicitly or report any upstream limit. Remove the current silent 500-source truncation: an enabled source cannot disappear without a continuation or visible capacity state.

Verify the installed server's actual GraphQL input/output contracts during implementation. Use the existing `fetchSourceManga` family for remote discovery where supported, followed by details/chapter/page operations. Each capability starts `unverified` until established; distinguish verified supported/unsupported capability from a supported operation's current unavailable service state. An outage must not permanently mark an operation unsupported. The spec does not assume that every source supports popular, latest or text search. A source that needs a title URL, such as a link-oriented catalog, gets a validated title-link entry flow only if its installed extension supports resolution. Otherwise the unsupported action is visibly unavailable; empty local indexed results are not presented as a successful remote search.

Browsing supports provider, integration, language, category and text-query filters. English is the initial translation preference, with multilingual feeds retained as such and other languages available explicitly. Do not mislabel a multilingual or unclassified record as English. A title is MANHWA only when provider metadata or a verified mapping establishes that subtype; otherwise retain MANGA without guessing.

### 5.1 Site-wide discovery surfaces

| Surface                                 | Required behavior                                                                                                  |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Manga/manhwa home and category shelves  | Show eligible cached/provider results with a visible provider identity and links into the current section          |
| Full browsing and search                | Query remote enabled catalogs with pagination and provider filters; include provider-only titles                   |
| Search suggestions                      | Include bounded cached matches from eligible providers; never fan out to every installed source on every keystroke |
| Title details and chapter directories   | Resolve the selected title, available integrations, source languages and chapter editions                          |
| Reader                                  | Open the exact edition, load pages, switch sources deliberately, preserve local imports and existing controls      |
| Library, Continue Reading and bookmarks | Retain provider title/edition references across reload, account sync and source outages                            |
| Community and shared reading links      | Preserve destination and stable media/edition identity; never drop provider-only titles through a MAL-only filter  |

Metadata-only core discovery can retain its existing MAL catalog cards; it must not label those cards as having a verified MangaDex or Weeb Central chapter match before resolution. Existing reviewed Ara Ara entries remain available as editorial content alongside extension discovery. An extension integration does not create anime playback sources.

### 5.2 Bounded aggregation

Fetch on demand and reuse cache; do not crawl every title or download every chapter. Start with at most four source-page operations per foreground aggregate request, no more than two concurrent provider operations, and a 12-second aggregate discovery budget. Keep the existing bridge's serialized Suwayomi queue until bounded concurrency has been validated on the installed server. Do not allow the queue to grow without a pending-work cap and busy response.

A versioned opaque continuation cursor records source/language positions, already-emitted logical identities, and an effective-selection fingerprint. Schedule eligible sources fairly across pages, not always the same first four. Return successful results and per-source loading/error states when another source is slow. Source-specific browsing must remain available. Cancel superseded searches and honor retry/backoff responses. Treat aggregate totals as unknown or estimated unless complete; do not claim an empty selected catalog set when some providers failed.

Failed or unattempted source positions are not advanced; retain them with retry/backoff metadata, while scheduling other sources so one repeated failure cannot stall the aggregate. A source page filtered to zero eligible results can still have continuation. Cursors expire after 30 minutes and are at most 2 KiB in client requests; bounded server-side continuation state holds larger position/deduplication sets. Cap each continuation session at 1 MiB of state and explicitly request a fresh search or provider-specific browsing when that budget is exhausted. Expiry, effective-selection fingerprint mismatch or invalid cursors return a restart-required response without reusing another account/destination's state. No truncation may masquerade as complete results.

Popular/latest ordering is the provider's ordering within that provider. A mixed aggregate uses deterministic fair interleaving and labels the feed; do not invent comparable global scores, publication dates or popularity ranks.

## 6. Media identity, editions and persistence

Keep existing `mal-anime-*`, `mal-manga-*`, MangaDex UUID chapter IDs, `sw-weebcentral-*` IDs and imported chapter IDs valid. Add provider-native media IDs under a separate namespace, such as `ext-manga-<opaque-stable-id>`. The identifier is minted from a stored source reference, not trusted from browser metadata or a guessed MAL match.

The authoritative external reference consists of integration, exact source ID, language and the provider's stable title key/canonical path. Store the current Suwayomi numeric manga ID as a lookup detail, not the public permanent identity. Maintain a stable mapping so a Suwayomi reindex can update local numeric references without changing saved public links. Do not change canonicalization rules casually; retain aliases when a provider changes its path format.

Bind local numeric lookups to a persisted bridge-instance identifier. A new bridge runtime or restored database must revalidate/rebind canonical source/title ownership before reusing a lookup; matching local integers are insufficient. Keep public title identities stable when that rebinding verifies the same upstream reference. Generic adapter identifiers are explicit, such as `suwayomi:<sourceId>`, and never sent through the dedicated `mangadex` or `weebcentral` branches by guesswork.

Use an opaque edition ID for new chapters, mapping to that title/source and the provider's stable chapter key. Store chapter number, volume, title, language, release group, order and page count as metadata. Chapter zero, decimals and unnumbered specials remain distinct. Page URLs identify an edition and bounded page index, never an arbitrary image URL. Validate manga/source/chapter ownership again before returning chapter manifests or images.

Introduce additive records for provider source capabilities, external title references and normalized metadata, edition references, verified cross-provider/core mappings and per-account integration mode. Keep transient query/feed caches separate from authoritative identities and account preferences. The same schema contracts apply to SQLite and D1. Retain all applied migrations and add new migrations only.

Aggregate the same work into one title card only when a trusted exact mapping or verified canonical identity establishes equivalence. Similar title text is insufficient; sequels, editions and remakes stay separate when uncertain. Records keep their original stable ID and reference even after a verified grouping is added. Do not migrate or combine user progress implicitly.

Extend the shared media-reference validator and server media resolver rather than simply allowing arbitrary strings through existing MAL validators. Update library, resume, ratings, comments, watch/read activity, chapter-calendar references, room state and WebMCP schemas where they accept reading identities. Unsupported upstream MAL operations are unavailable for provider-only records; they do not receive fabricated MAL IDs. Account-scoped mutation guards remain mandatory.

## 7. Defaults, overrides, destination and content eligibility

For every discovery, details, chapter and image request, resolve:

1. Request destination: Yoru or Ara Ara.
2. The visitor's effective provider membership: shared defaults plus their overrides.
3. Saved or explicit integration mode and requested source/language.
4. Source capability and title eligibility in that destination.

Provider membership is a preference, not proof that every title from a mixed catalog is eligible for Yoru. Preserve Yoru's existing non-explicit content rules; keep adult results out of its discovery, suggestions, cached cards, covers, chapters and shared previews. Ara Ara continues to use its age-confirmation flow before presenting adult discovery/reader UI. An integration mode cannot bypass that flow. Do not describe the existing browser age confirmation as strong age verification or authentication.

Use provider classification and verified title metadata for eligibility. Preserve unknown/mixed classifications explicitly and withhold unclassified potentially adult titles from Yoru until resolved. Ara Ara may show eligible selected-provider results within its existing gated flow, with their source classification retained; arbitrary untrusted adult-only sources are never relabeled safe. Aunt Manhwa's existing membership in both sections remains intact; individual title eligibility still determines where each result can appear. New providers retain the existing disabled default.

Carry destination consistently through API calls, image/cover references, prefetching, imports/links, account queries and rooms. Request caches must distinguish destination, integration, effective source-selection fingerprint, language and query. Personalized responses must also be account scoped and no-store where appropriate. Shared provider metadata caches may be reused internally, but response filtering happens before public serialization; a late response from a previous destination/account cannot populate the current view.

Apply destination filtering symmetrically to both Yoru and Ara Ara. Normal Yoru must not return every library/resume/community/public-room record once Ara-native titles exist. Filter server list queries before `LIMIT`/pagination, and scope direct room lookup, joining, preview data and reader iframe URLs. Do not implement membership using only the IDs from the currently loaded browse page. Hide ineligible or disabled saved records from that section without deleting account progress. Private account export can retain the user's complete stored records with explicit destination labels; it must not become a public discovery endpoint.

For signed-in requests the server resolves stored preferences from the session. Guest overrides may be sent as a bounded validated preference projection for filtering, never as an account selector or authorization grant. A disabled provider must not continue fetching because an older cached feed, saved source, hover preload, direct chapter URL or outage fallback selected it.

## 8. Failure behavior and resource limits

Failures stay local to the affected integration/provider. In `all`, healthy core/extension results remain usable when another group fails. In a deliberately selected single-group mode, show that group's error and an explicit **Switch to All sources** or other-group action; do not silently change the selection.

Distinguish unsupported operation, no matches, empty successful catalog, no enabled sources, source removed, authentication required, access challenge, rate limiting, temporarily offline and expired bridge registration. Do not route users to unrelated titles or substitute a local import for a failed remote chapter. Do not bypass provider payment, authentication, CAPTCHA or access challenges; report the unavailable operation instead.

Preserve actionable upstream 401/403/429 and retry intervals across bridge/API normalization instead of flattening everything to 503. Public errors must describe the source/state without revealing internal credentials or private host details. Keep existing calendar feeds unchanged; add extension release rows only when real upstream dates are available, never by treating chapter order as a timestamp.

Preserve existing image MIME/byte limits, 500-page chapter bound, same-origin image delivery, cache pruning and secret isolation. Extend hashed cache keys with integration/source/title/edition identity and destination eligibility. Covers require the same validated source/reference treatment as pages and must not turn the bridge into a general image proxy. Cache useful last-good discovery results with a stale label; provider deletion or destination ineligibility must still exclude those results immediately. Apply a size/age budget to new metadata caches as well as existing image caches.

## 9. Implementation sequence and release boundaries

The subsequent implementation plan should produce the following coherent increments, preserving the existing adapters throughout:

1. Shared source/media/edition contracts, additive schema and destination policy, including integration-mode preference persistence and backwards-compatible resolver tests.
2. Generic bridge capabilities, remote browse/search, details, chapters, cover/page delivery and bounded caches, verified against the installed Suwayomi schema.
3. Node/Sites catalog aggregation and source-native title APIs with server-side effective preference enforcement, pagination and independent failure states.
4. Discovery/search/title/reader selector wiring and Ara Ara collection updates, followed by account/library/resume/community/room/WebMCP compatibility.
5. Full local checks, a provider capability/availability matrix, selected live browse-to-page probes, bridge rebuild/recreation, exact Sites artifact publication and production verification.

Do not publish intermediate UI that claims all providers can browse/read while only Settings or static fixtures work. Provider-specific missing capabilities and inaccessible providers must be reported explicitly. The first release is complete only when the new integration works end-to-end for real supported providers, both destinations and both preserved core adapters, with unsupported/unavailable cases represented honestly.

Build the new bridge image before recreating only the bridge service; preserve the Suwayomi service, private configuration and all volumes. Deploy compatible additive APIs and migrations before enabling dependent UI. Keep the previous Sites saved version and prior bridge image recoverable. Rollback switches off the generic integration and restores compatible prior artifacts without removing identity/account tables or saved records.

Establish a destination-aware rollback version before admitting Ara-native records into account/social storage. After those records exist, version 106 and other older unscoped list handlers are not valid rollback targets. A rollback must retain the new destination filters while disabling generic discovery, or it could expose Ara records in normal Yoru lists.

## 10. Acceptance and evidence

The implementation is accepted when all of the following have evidence:

- A fresh visitor gets the version-106 Yoru/Ara Ara assignments and `all` mode. Each provider's language editions inherit its membership.
- Account integration-mode changes and provider overrides follow a fresh browser; guests remain local. Reset restores defaults. Stale GETs, account switches and overlapping mutations cannot undo a completed preference change.
- The three selector modes produce their defined result/source sets. Both existing core adapters remain selectable and their current links still resolve. A generic failure does not break the dedicated path.
- A remote extension browse/search fetch discovers a title not previously indexed in the host library; it appears as a site card and opens details, chapters and native pages. A provider-only title needs no MAL match.
- At least two additional non-core providers with different supported feed behavior complete live browse-to-read checks. A selected Ara Ara provider completes its supported gated discovery-to-reader flow using suitable adult-only test fixtures for automated checks and lawful live provider material. Record each installed provider's tested/unsupported/unavailable/unverified operations rather than extrapolating from these examples or from successful discovery alone.
- Filtering, fair continuation paging, provider language choice, incomplete totals and cancellation work with many enabled catalogs. Every enabled capable source is reachable through continuation/provider-specific browsing; no first-sources-only starvation.
- Yoru never receives adult-only data/cover/page responses through aggregate caches or direct external references; Ara Ara retains its gate. Both-section provider assignment does not override per-title eligibility.
- Exact edition ownership checks reject mismatched media/source/chapter references, arbitrary URLs, arbitrary GraphQL, unsafe image paths, invalid 64-bit IDs and unauthenticated bridge calls.
- Imported chapters, chapter zero/decimals, reader layouts, translation choice, bookmarks, page resume and saved lists survive mode/source changes. Existing shared rooms stay pinned to the host's exact edition; personal browse mode never changes shared state.
- Provider-native IDs work consistently in library, Continue Reading, chapter activity, title discussions, shared links and applicable WebMCP tools. Unsupported MAL sync/export operations are clearly unavailable, with no fabricated identity.
- No full-catalog crawl or unsolicited chapter download occurs. Queue, request, cache and page limits are enforced under overlapping requests; sleeping PC and provider outages yield retryable states.
- Repository formatting, Node build/unit tests, relevant Node browser journeys, Sites build/runtime tests and desktop/phone Sites journeys pass. Record any retries or external CI limitations explicitly.
- Rebuilt Docker bridge and deployed Sites are verified together using the exact published commit/archive, including existing core reading plus new generic extension browsing/reading. Build success alone is insufficient.

## 11. Alternatives considered and decision

**Selected: coexistence with on-demand extension discovery.** It preserves the working dedicated adapters, gives one consistent source policy and avoids a full upstream mirror. Provider capability differences remain visible.

**Replace the dedicated adapters with generic extensions:** rejected because it removes a known working route, changes compatibility and prevents the requested integration switch from being meaningful.

**Keep a separate extension browser only in Settings, or mirror every full catalog:** rejected. Settings-only does not meet site-wide discovery/reading; a full mirror adds unbounded crawl/storage/provider load without improving exact identity or availability.

The user's approval of this document is the next review boundary. After that, prepare a separate implementation plan with file-level tasks and verification steps before product implementation.
