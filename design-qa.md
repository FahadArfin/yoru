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
