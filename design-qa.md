# Homepage reference fidelity — October 13 revision

final result: passed

## Target and evidence

The user's six attached Anixo screenshots define the requested correction: a nearly full-screen, edge-to-edge banner with a floating inset pill navigation, small title/logo and buttons near the lower left, and a right rail containing Most Viewed, Upcoming, Airing Schedule, and Community. This supersedes the earlier report's decision to shrink the banner.

Compared the supplied Heavy Knight screenshot (2490 x 1008 including browser chrome) and current rendered Heavy Knight screenshot together. Implementation browser viewport: 2048 x 930 CSS pixels, device scale 1. Source chrome and aspect ratio differ; comparison uses proportional dimensions, not a claim of pixel-perfect equality. Hero is 837px high (90% of viewport), full content width. Saved captures: `C:/Users/fahad/AppData/Local/Temp/yoru-revision-hero.png` and `yoru-revision-mobile.png`.

## Corrected findings

- P1: Previous banner was only 500–580px high with a portrait confined to the right. Changed to 90svh, full-bleed artwork, restrained bottom shading. Current Heavy Knight backdrop is the same asset as the reference.
- P1: Previous title dominated the art. Added the matching transparent title logo; fixed a remaining >=1700px 74px heading override and defined the screen-reader-only label. Post-fix capture shows small lower-left logo and actions.
- P1: Missing right-hand cards. Added a 290–390px rail beside the release grid, stacking all four requested panels. Poster thumbnails, muted grayscale backdrops, compact metadata, rounded charcoal cards, and date/filter controls match the supplied sidebar direction.
- P2: Date offset used today rather than selected day. Corrected to selected-date offset; DST regression checked in America/New_York across October 27–November 1.
- P2: Sidebar data remained stale after library changes. Added event-driven and five-minute visible-page refresh.

## Required fidelity surfaces

- Typography: small uppercase rail headings, compact row text, real title logo; existing DM Sans retained for Yoru. Reference branding is not copied.
- Spacing/layout: desktop hero 90% viewport; six release columns on wide desktop, four on smaller desktop, three on phones. Rail uses roughly one fifth of width. Phone rail stacks below primary content with no horizontal overflow (393 x 852 checked).
- Colors: blue-charcoal page, slightly lighter charcoal panels, restrained purple Yoru accents, grayscale row backdrops, gold upcoming dots/scores.
- Imagery: exact reference Heavy Knight art/logo, verified Apothecary series artwork, live release/upcoming poster art. Unsupported series retain provider art; not all provider metadata offers a wide backdrop.
- Copy/content: live Yoru data replaces reference content. Most Viewed explicitly describes watched-library counts and labels popularity fallback. Community uses real posts or a useful empty state. No copied community identities, invented comments, or fabricated view counts.

## Verification and remaining differences

Desktop and phone journey tests cover carousel navigation, release language and exact episode links, all four panels, local schedule filters, overflow, and navigation. Backend tests verify exact identities, watched-library aggregation, cache persistence, stale fallback, credential omission, and Node/Worker behavior. Visual browser inspection covers the full-height hero, poster grid/right rail, schedule rows, and phone stacking.

Acceptable product differences: Yoru branding/navigation, live Yoru content, curated reading shelves and genuine community empty state; no external Discord promotion. The user requested hero proportions and sidebar cards, not the reference's additional three summary columns.

## Banner quality correction, 2026-10-14

The Heavy Knight reference backdrop decoded to only 1280 x 720 despite its provider URL saying original. Removed that override. Kitsu now prefers original artwork over its resized large variant, with a new cache key so previously cached small images are replaced. Before displaying any slide, the browser checks decoded dimensions: minimum 1920 x 1080, landscape aspect ratio, and enough pixels for the actual cover container at device density up to 2x. Checks update on resize. No poster or icon is stretched into the banner when artwork fails; all weekly titles remain in the sidebar and catalog. Slow successful loads can recover after the loading placeholder times out.

Local visual inspection at 1786 x 1234 verified Apothecary artwork decoding at 3840 x 2160, preserving the 90svh hero and compact title logo. Browser regressions cover carousel/release/sidebar behavior, low-resolution and failed images, resize rejection, and recovery after a delayed image load. Provider dimensions cannot establish the artistic detail of every original or guarantee artwork exists for every weekly title; unqualified titles are omitted from banner slides.

## Restore banner variety, 2026-10-14

The initial quality correction left only one qualified source. Verified additional series artwork from TMDB: Heavy Knight, Black Clover, Returner's Magic, and Reincarnated Aristocrat decode at 3840 x 2160; Sword decodes at 1920 x 1080. Gallery provenance is recorded in `server/home-artwork.js`. Series promotional artwork is cosmetic and does not change MAL season IDs or release metadata. Local preview showed six slides at 1266 x 714, five at larger sizes where Sword does not qualify. Inspected all four new 4K images in the carousel. Expanded the weekly candidate pool to twelve, showing up to eight qualified slides and preserving the current slide when later images load. Existing image-quality requirements remain unchanged.

## Dense catalog correction, 2026-10-14

final result: passed

Reference: `C:/Users/fahad/AppData/Local/Temp/codex-clipboard-887fc0dc-185a-47b9-abe5-0b62ea4b8ea5.png` (2382 x 1308, including approximately 114px of browser chrome). Compared the content layout at a 2382 x 1194 viewport. Implementation evidence: `C:/Users/fahad/AppData/Local/Temp/yoru-browse-wide.png` and `yoru-browse-phone.png` (393 x 852 viewport). Captures omit browser chrome; the browser capture surface can clip a small part of the viewport height.

- Layout: removed the permanent browse sidebar and reused the homepage pill navigation. Nine columns on wide desktop, seven on medium desktop, three on phones; two below 360px. The first poster starts at y=208 rather than below the former large introduction. Live catalog returned 48 titles; previously the page requested 24. Full-page structure and focused header/poster spacing were compared against the reference.
- Typography: compact 18px heading and 11px centered two-line poster titles; existing DM Sans and Yoru branding retained.
- Spacing: unified search/category/genre/sort controls, narrow poster gutters, 2:3 covers and restrained vertical gaps. Phone controls wrap into two rows with no horizontal overflow.
- Colors and imagery: homepage blue-charcoal background and dark filter bar; actual catalog covers, format and score badges. No copied logo, fabricated subtitle availability, or placeholder production content.
- Content and behavior: preserved live search, category routing, filters, saved-result recovery and exact namespaced title links. New regression covers 48-result pagination, scroll reset, filter reset, manga navigation and hamburger dismissal on desktop and phone.

Intentional differences: Yoru navigation, nine equal responsive columns, live catalog order and real score badges; reference subtitle/dub counters are not available from this metadata source. Other interior pages keep their existing navigation.

---

# Manga title layout QA

Date: 2026-10-17

## Reference and scope

The supplied MangaDex Cosmos title screenshot is the visual reference. The live reference page could not be inspected in the browser, so the implementation uses the supplied screenshot rather than claiming a live-site comparison. The target is Yoru's existing manga and manhwa title pages, retaining their working catalog, library, discussion, reviews, and reader integration.

The reference was inspected alongside the final Yoru captures at a 2468px desktop viewport, with the source's browser chrome excluded from layout measurements. A separate 390px phone check covers responsive behavior. The real Noro-Noro Puku-Puku title has three catalog editions; its content and chapter count are intentionally not replaced with the Cosmos example.

## Visual comparison

| Surface                       | Result | Evidence                                                                                                                                                                                             |
| ----------------------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Composition and spacing       | Pass   | Cover and large title share a compact header; synopsis sits above tabs; metadata and chapter directory form the same left/right hierarchy. Removed the inherited directory top gap.                  |
| Typography                    | Pass   | Strong title, bold compact section labels, readable chapter titles and muted secondary lines. Increased desktop type after the first comparison.                                                     |
| Color and shape               | Pass   | Charcoal page, flat gray chapter rows, small rectangular metadata chips, restrained borders. Yoru branding and purple actions remain.                                                                |
| Chapter imagery and detail    | Pass   | Real cover artwork and local language flags; scanlation group, release date, Yoru opens and rating controls remain on each edition. No invented provider statistics.                                 |
| Density and responsive layout | Pass   | Desktop edition rows are 54px; repeated translations nest under one chapter. Phone places chapters before metadata, wraps actions and preserves dates without horizontal overflow in browser checks. |

## Iterations and interaction checks

1. Replaced the large banner and loose cards with a dedicated manga/manhwa title layout, grouped volume rows, collapsible translations and an index.
2. Increased text sizes after side-by-side inspection, corrected hidden accessibility text and provider labels, and removed excess spacing.
3. Fixed synopsis expansion based on measured clipping, including descriptions shorter than 450 characters. Restored phone dates and moved keyboard focus to the indexed volume.

The chapter browser suite passes on desktop and phone: filters, pagination, rating dialogs, authenticated ratings, unavailable-feed retry, collapsible volumes and translations, index focus, sorting, synopsis expansion on resize, manga/manhwa routing and anime tab regression. Existing reader flows remain covered by the reader suite.

## Evidence and limits

- Source: user attachment `codex-clipboard-69b81619-a3ca-42f7-bfd3-f902116c8506.png`.
- Desktop capture: `C:/Users/fahad/AppData/Local/Temp/yoru-dex-desktop-final.png`.
- Phone capture: `C:/Users/fahad/AppData/Local/Temp/yoru-dex-phone-final.png`.
- Browser console had no errors during the local visual check.
- This reproduces the requested title-page structure, not all MangaDex platform features. Art uploads, reporting, external user profiles and MangaDex comments are not fabricated. The established external chapter-reading links and local imported reader are preserved.

Design QA: **passed**. Release verification is recorded in the pull request and deployment checks.

## Recommendation covers — 2026-10-17

**Final result: passed.** Replaced the metadata sidebar's alternative-title list with four related title covers and a working See more link on manga and manhwa pages. Header subtitles still use the title aliases.

Reference: user attachment `codex-clipboard-8b3a347f-c2c7-4598-ab26-07ce8ca0d413.png` (466 × 719 cropped sidebar). Compared the source and the rendered desktop capture together in one visual review; the reference's approximately 400px grid is a sidebar crop, not a phone viewport. Yoru's sidebar is 272px wide at the checked 1280 × 720 desktop viewport; the responsive phone grid is 343px at 390 × 844. The existing page proportions are intentionally retained.

| Fidelity surface   | Result                                                                                                                                                                                                                                                                     |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Typography         | Bold Recommendations heading, readable white title overlays with at most three lines, and centered See more with an arrow. Existing DM Sans matches the rest of Yoru.                                                                                                      |
| Layout and spacing | Two columns, four portrait covers at a 2:2.85 aspect ratio, 8px gaps, 3px corners. Phone recommendations span the metadata section instead of squeezing into one column.                                                                                                   |
| Colors             | Existing charcoal page and white text retained; dark shading keeps labels readable on bright covers. Visible keyboard focus and reduced-motion support.                                                                                                                    |
| Image quality      | All four real catalog covers loaded in the browser at 600px tall, larger than their rendered sizes. No generated covers or placeholder recommendations. Subjects intentionally differ from the Cosmos screenshot because recommendations belong to the current Yoru title. |
| Copy and content   | Correct Recommendations spelling. Genre overlap ranks suggestions from the same manga/manhwa category; self, duplicate IDs, adult/imported items and records without covers are excluded. Empty/error states explain the absence without fabricated titles.                |

No P0/P1/P2 findings remain. Live local clicking of Dandadan opened the matching title; See more, genre filtering, same-category routing, fallback and retry passed on desktop and phone. The chapter tests preserve English defaults and translation selection. No horizontal phone overflow.

Evidence: `C:/Users/fahad/AppData/Local/Temp/yoru-recommendations-desktop.png` and `C:/Users/fahad/AppData/Local/Temp/yoru-recommendations-phone.png`. Catalog covers and results can vary with provider data. See more opens Yoru's filtered catalog rather than introducing a separate recommendation-management page.
