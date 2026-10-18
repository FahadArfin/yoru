# Ara Ara: mature, non-explicit collection

Ara Ara lives at `/ara-ara` on the existing Yoru site. The NSFW button opens it directly. It has separate branding and navigation, a tab-session 18+ confirmation, and twelve editorial picks across anime, manga and manhwa. This is a curated mature-themes collection, not a comprehensive age-rating database. Its 18+ gate is a visitor confirmation, not identity verification or a claim that every title carries an 18+ provider rating.

## How the connection works

`shared/ara-ara.js` lists the reviewed media IDs, categories and short editorial notes. `server/ara-ara.js` resolves those IDs through Yoru's existing `getMedia` pipeline: current Tenrai metadata, mapped Kitsu metadata and the existing saved catalog. No new provider credentials are needed. The original provider ratings and attribution stay on the records. Explicit/adult flags and explicit genre labels still exclude records, including previously cached records. A missing or excluded record is omitted rather than replaced with a different title.

Catalog metadata describes a title. It does not supply an episode video or chapter pages. Players, readers, library entries, comments and rooms continue to use Yoru's existing services and IDs. Ara Ara uses the same homepage, category, title, watch, reader, schedule and My Space components as Yoru. Navigation stays under `/ara-ara`; comments and account progress use the same title IDs. Adding a catalog ID does not guarantee playable media or chapter availability.

## Add another mature, non-explicit title

1. Find the title in Yoru's normal catalog and open its title page. Copy its exact ID from the address: `mal-anime-...` for anime or `mal-manga-...` for manga/manhwa. Do not substitute an AniList ID or infer an ID from a title name.
2. Review the work and its provider classification. Choose a non-explicit work that fits the collection's mature themes. Provider demographic labels alone are not an editorial review.
3. Add one entry to `araTitles` in `shared/ara-ara.js`. For example, the existing Death Note entry is:

   ```js
   { id: 'mal-manga-21', category: 'MANGA', note: 'A psychological duel about justice and power.' }
   ```

   Use `MANHWA` for Korean comics while retaining the `mal-manga-*` ID namespace. Keep IDs unique. Do not change the content exclusions.

4. Ensure the title's metadata resolves through `/api/media/ID`. If you want it to remain available on a completely fresh offline install, add a sourced metadata snapshot using the project's existing seed workflow; never invent ratings, counts or artwork. The membership test checks reviewed seed entries so an offline release cannot silently lose a title.
5. Run the standard release checks in `AGENTS.md`, including the Ara Ara tests. Preview desktop/mobile, the gate, category/search filters, the title, schedule and community views. Publish through the existing Yoru release workflow.

The catalog updates when that source change is published. There is no separate Ara Ara site or duplicate account system.

## Schedule and community behavior

- Schedule uses the same broadcast/sub/dub controls and chapter-language controls as Yoru, with AnimeSchedule episode times and MangaDex chapter releases through Yoru's existing integrations. It matches only collection members: exact catalog IDs when present, otherwise exact normalized title aliases. It never guesses a sequel or invents a release date. Chapter results can be paged with **Load more chapters**. Provider outages and incomplete results are labeled.
- The community feed filters comments and reviews by the resolved collection IDs before the database limit. Members can use the existing authenticated comments, replies, reactions and reviews from an Ara Ara title. These are shared title discussions, not a private or separately moderated community.
- Watch/read rooms are created from the title with Yoru's existing room launcher. Native video/HLS can synchronize; third-party embeds retain their existing limitations.
- Browsing requests start only after confirmation in the UI. The catalog API is public metadata and is not an authentication boundary.

## Provider references

See [SOURCES.md](SOURCES.md) for the connections actually used by this checkout. [Jikan's primary GitHub repository](https://github.com/jikan-me/jikan) is an example of a MyAnimeList metadata library; it is not a source of video or chapter files and is not a new integration in this change. The implementation keeps the current Yoru providers rather than installing a different catalog stack.

This guide covers non-explicit catalog additions only.

## Shared presentation

`CollectionBoundary` supplies reviewed membership after the age confirmation. `collection-router.jsx` keeps shared component links in the selected collection; Yoru paths remain unchanged outside that boundary. `collection-view.js` scopes catalog search, discovery feeds, recommendations, rooms and discussions. New-series and popularity shelves use the reviewed catalog metadata; trending and release shelves use actual feed entries restricted to those IDs. Empty feeds stay empty. Library and resume cards use the same account data filtered to the collection. The global community chat and presence remain shared.
