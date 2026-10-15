# Content ratings and the NSFW navigation

Reviewed October 15, 2026.

## Shipped scope

The top navigation opens three labeled category links: Hentai anime, Hentai manga, and Adult manhwa. The mobile navigation links to the category landing page. Direct category links require the same 18+ confirmation as the landing page. Confirmation is stored in sessionStorage for the current tab; leaving the section clears it. This is a visitor declaration, not identity or verified-age assurance.

These screens are navigation and empty collection states only. No adult-title catalog, artwork, descriptions, media sources, or external catalog links have been added. The page does not request catalog data. The regular browse and discovery filters remain unchanged.

## Findings relevant to a non-explicit metadata catalog

- Yoru already normalizes `rating` and `isAdult` in `server/catalog-core.js`. Jikan normalization checks explicit genres and ratings; Kitsu normalization checks its NSFW flag and age rating. Public discovery excludes adult-tagged records, and Jikan discovery requests use its safe-for-work filter. Do not remove those defaults to populate a separate section.
- [Jikan's maintainer announced that its public API was discontinued on October 1, 2026](https://github.com/jikan-me/jikan-rest/issues/613). The announcement was posted October 10. The regular catalog already has Kitsu and persisted-cache fallbacks, but public Jikan availability must no longer be assumed when planning new metadata features. No endpoint migration is included in this navigation change.
- [Jikan's documented safe-for-work policy](https://github.com/jikan-me/jikan-rest/issues/218) filters explicit genres and anime ratings. That is a content filter, not a guarantee about every cover image or description.
- [AniList documents an adult-audience classification](https://docs.anilist.co/reference/object/media), but [its considerations page](https://docs.anilist.co/guide/considerations) explicitly says content filtering is not guaranteed to match other services' standards. Yoru does not currently call AniList. This research does not approve a new provider or establish permission to reuse its images or data.

## Requirements for any future non-explicit metadata import

Keep media identity, content classification, provenance, and publication approval separate. A record would need its provider and provider ID, anime/manga type, manga subtype, neutral display title, rating, classification source, review status, and last-checked timestamp. An unknown rating must remain unknown; manga/manhwa format or a reader's age declaration must not supply it.

Use reviewed, non-explicit artwork and summaries, with neutral placeholders otherwise. Keep collection membership separate from the general discovery feeds and their caches. Metadata does not establish video or chapter availability, so catalog records should not generate playback or reader sources. The current change intentionally ships no import implementation or populated collection.
