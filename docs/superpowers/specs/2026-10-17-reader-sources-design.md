# Multi-source reading on the temporary desktop host

The user approved Suwayomi on this Windows PC through Docker Desktop, including cached images, connected to the existing public Yoru Site. Preserve Yoru's manga/manhwa reader, English defaults, imported editions, saved progress, and all anime behavior.

Sites keeps the UI and its authenticated application API. A narrowly scoped Node bridge connects to a private Suwayomi container. Only source discovery, verified title chapters, chapter page lists, and page images cross this bridge. No GraphQL, extension administration, arbitrary URL proxy, or Docker socket is publicly exposed. A generated shared secret authenticates requests and the bridge's expiring endpoint registration. Secrets stay in ignored local files and Sites environment settings.

Use MangaDex and a small allowlist of additional maintained extensions. Resolve source identities from exact MALSync manga mappings and compare the returned source URL identity, not the first title search result. Keep sources and editions distinct. Unmatched, unavailable, official external-only chapters, denied requests, and source outages remain explicit. Do not bypass provider access controls or fetch whole catalogs.

The PC host is temporary. A Cloudflare Quick Tunnel can support this pilot; its changing hostname registers automatically with Sites using the shared secret. Expired registrations fail closed. A named tunnel can replace this later without a reader rewrite. Docker volumes retain source mappings and cache; limit cache age and size. Do not enable automated chapter downloads or challenge solvers. Existing metadata-only source behavior remains available when the bridge is not configured.

Acceptance: prove exact mapping and native reading for an available manga and manhwa, source/language selection, page/chapter navigation, reload/resume, and repeat-page cache use; deny unauthenticated bridge access, mismatched title/chapter IDs and arbitrary image paths. Run existing format/build/unit/Worker/browser checks and verify the deployed Site against the real container before claiming availability. Record any title that remains external-only.
