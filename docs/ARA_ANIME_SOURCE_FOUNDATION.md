# Ara Ara anime source configuration foundation

The owner will enter sources manually and use another model to implement the integration. No website-specific adapters, crawling, or automatic imports are included here. The example configuration is a handoff contract, not an active runtime setting; existing catalogs are unchanged.

Start from `config/ara-anime-sources.example.json`. Preserve `destination: "ara-ara"` and `category: "ANIME"`; Yoru and reading catalogs must not use this configuration.

- `version`: configuration schema version, currently 1.
- `mode`: `default` uses the existing curated Ara anime catalog; `custom` uses only enabled custom sources. The future Settings switch must always allow returning to default.
- `sources`: owner-entered records, each with `id`, `label`, `kind` (`manifest` or `adapter`), `url`, and `enabled`. An empty custom list should show an empty state and a Settings link, never silently mix the default catalog into it.

For a manifest source, require a documented JSON catalog with stable, source-namespaced IDs, title, cover URL, description, genres, and source page URL. Preserve content classification and provenance. Provider URLs alone are not importable catalogs: arbitrary HTML websites require separate adapters and are outside this foundation. Do not accept scripts or execute uploaded configuration. Do not store access tokens in this public file.

Implementation entry points: `server/ara-ara.js` currently supplies the curated catalog; `shared/collection-view.js` scopes browse results; `src/pages/Settings.jsx` is the settings UI. Both `server/catalog.js` and `sites/worker.js` need matching API behavior. Preserve `shared/ara-ara.js` content eligibility rules and do not assume custom IDs are MyAnimeList IDs.

Before enabling the feature, validate source URLs server-side against SSRF, bound file size/item counts, sanitize metadata, cache imports with provenance, and keep explicit user overrides separate from site defaults. Verify default/custom switching, an empty custom catalog, disabled sources, import failures, restoring the default, Node/Sites parity, and unchanged Yoru routes. The settings UI should explain whether a change is device-local, account-specific, or a site-wide owner setting.
