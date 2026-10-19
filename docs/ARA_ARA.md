# Ara Ara

Ara Ara lives at `/ara-ara` on the existing Yoru site, with separate branding and navigation and the existing tab-session 18+ confirmation. The confirmation is a visitor acknowledgement; it is not authentication or strong age verification. Leaving Ara clears confirmation. Content, cover and reader requests wait for confirmation and the current shared reader selection.

The reviewed non-explicit editorial collection in `shared/ara-ara.js` remains available. When the generic integration is enabled on the server, Ara also admits eligible provider-native manga from its selected Suwayomi catalogs. These titles need no MAL match. Provider classification and its provenance remain on the records. Unknown or mixed classifications are not relabeled safe, and assigning a provider to both sections does not make each of its titles eligible for Yoru.

## Source selection

Both sections default to `all`. Settings preserves the 21 historical provider assignments, personal overrides and all language editions of each provider. New providers start disabled. The selector has exactly these modes:

| Value        | Label                   | Discovery behavior                     |
| ------------ | ----------------------- | -------------------------------------- |
| `all`        | All sources             | Eligible dedicated and generic results |
| `core`       | MangaDex + Weeb Central | The existing dedicated adapters        |
| `extensions` | Suwayomi extensions     | Eligible enabled generic catalogs      |

Dedicated MangaDex uses its API. Dedicated Weeb Central already uses Suwayomi with an exact MALSync mapping. Generic MangaDex and Weeb Central entries are separate `suwayomi:<source-id>` integrations; their presence does not replace the dedicated paths. Metadata-only core cards do not promise a verified readable chapter match. Enabling an extension does not establish that browsing, search, chapters or pages work upstream.

## Titles, account views and shared reading

Core `mal-anime-*` / `mal-manga-*` identities remain valid. Provider-native manga use stable `ext-manga-<32 lowercase hex>` IDs and exact `ext-chapter-*` editions. Similar names or chapter numbers do not establish equivalence. A saved edition and its progress stay pinned when discovery mode changes or another adapter fails. Unsupported MAL sync operations stay unavailable; private export retains native records with null MAL IDs. MAL XML import format remains unchanged.

Library, Continue Reading, title discussions, chapter activity, rooms and shared links carry destination and exact identity. Server eligibility filtering applies before pagination, including normal Yoru lists. Hidden or disabled saved records retain their progress. Private account export can include the complete owner's records with explicit destination labels. Session identity chooses the account; a request cannot choose another owner. The global chat and presence retain their existing shared scope.

Ara's existing editorial schedule uses the current AnimeSchedule and MangaDex feeds. No extension calendar feed is fabricated from chapter numbers, order, fetched timestamps or undated activity. Native discussions/activity can exist without being dated release entries. Outages, incomplete results and unknown dates stay explicit.

## Editorial additions and evidence

For another reviewed editorial pick, find its exact Yoru MAL ID, verify its metadata and mature non-explicit suitability, then add a unique entry to `shared/ara-ara.js`. Preserve provider attribution and the editorial content exclusions; provider-native discovery does not require editing that list. Do not infer MANHWA from a title name or invent artwork, popularity, dates or a MAL identity.

See [source boundaries](SOURCES.md), [desktop host operations](READER-HOST.md), [page tools](WEBMCP.md) and the [acceptance record](qa/enabled-reader-catalogs-acceptance.md). Installed metadata, fixture tests and builds have different evidentiary scope; real provider and deployment acceptance remain marked pending until recorded.
