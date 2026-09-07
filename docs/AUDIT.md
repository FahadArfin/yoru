# Original app audit and Yoru direction

Inspected September 7, 2026. Source checkout: `../fahads-anime-manga-list`. Current-run screenshots are saved locally in `docs/audit/`; screenshots are excluded from source control to keep the new private repository lean.

## Captured flows

1. **Anixo home — strong visual reference.** `01-anixo-reference.png`: full-width artwork, a clear watch action, fast poster discovery, live community entry points. The supplied GitHub code does not include all the live site’s room/auth/community features. Its README claims MIT while also prohibiting commercial reuse, and no LICENSE exists.
2. **Original home — functional but crowded.** `02-original-home.png`: competing category, genre, status, year, source, and user controls dominate the view. Small metadata and implementation terms such as “db-fallback” appear in primary user flows. The banner and catalog work, but information hierarchy and reading rhythm need a redesign.
3. **Original account/list model — unsuitable for open registration.** Source inspection found a shared profile selector, client-supplied user IDs, optional site-wide Basic Auth, and whole-database JSONB snapshots. Those provide neither individual authorization nor safe multi-instance writes. This is a code finding, not a screenshot-derived accessibility claim.

## Rebuilt experience

Yoru uses a persistent desktop sidebar, a compact search bar, artwork-led discovery, calm violet accents, clear typography, and separate anime/manga/manhwa entry points. The homepage community panel reflects actual activity and deliberately has an inviting empty state before members arrive.

Title pages separate overview, units, discussion, and whole-title reviews. Watch/read routes preserve their own unit-specific thread. Saved-list state is conspicuous and belongs to the authenticated account; player source preference and timestamp are explicitly device-local.

Rooms handle anime and reading equally: shared episode/chapter context, real membership and live chat, host handoff, and private invitations. Native video/HLS synchronizes playback. External players that lack an integration API are labeled independent.

## Defects avoided

- No fabricated weekly chapter dates, no arbitrary 100-unit ceiling, and no lost comment draft after failed save.
- No client-selected identity or database document replacement for account writes.
- No changing resume prop on every playback timestamp save, which previously reloaded the video.
- No anime player applied to manga, and no MAL ID incorrectly passed as an AniList ID.
- No copied Anixo backend, no fake people or social statistics, and no implied live Discord integration before configuration.

Screenshots informed layout and hierarchy. Keyboard, interaction, responsive, persistence, and authorization behavior are separately verified through browser and API tests. This is not a formal certification of accessibility compliance.
