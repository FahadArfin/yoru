# Homepage visual QA

Target: an Anixo-inspired Yoru homepage, with weekly popular anime inside the banner and recent episodes directly below it. This is an adaptation of its composition, not a copy of Anixo branding, title-logo assets, advertising, or content order.

## Evidence

Reference: https://anixo.online/ (desktop and mobile). The in-app reference was obstructed by an advertising overlay; Edge provided the readable reference. No extension was installed.

Captures are in `C:/Users/fahad/.codex/visualizations/2026/10/13/01a13317-a07b-7623-a527-e620f3769f3a/`:

- `anixo-desktop.png`, `anixo-mobile.png`
- `yoru-home-desktop.png`, `yoru-home-mobile.png`

Both were captured at requested desktop 1280 x 900 and mobile 390 x 844 viewports, at the top of the homepage in guest state. Edge and IAB return different pixel densities and scrollbar/chrome bounds (reference 1568 x 1111 / 469 x 1041; implementation 1265 x 889 / 375 x 812). Comparison used content proportions and readable component regions rather than interpreting pixel-count differences as layout defects. Reference and implementation images were displayed together in the same comparison inputs. Featured titles intentionally differ because Yoru selects verified current-week data.

## Findings and fixes

- P2: Initial desktop banner pushed the first release row too far below the fold. Reduced its height to 500–580 CSS pixels. Revised capture shows the banner, release heading, language switch, and first poster row together.
- P2: A portrait fallback had an abrupt vertical edge against the hero background. Added a feathered mask on desktop; mobile preserves the full poster background. Revised captures show a continuous background.
- P2: Mobile hid the Watchlist text and removed the button's accessible name. Added a state-aware accessible label; the browser regression test checks that named control in both viewport projects.

## Fidelity surfaces

- Typography: Retains Yoru's DM Sans and wordmark; strong white featured title, compact uppercase navigation, smaller muted metadata. Long-title mobile slide inspected with the full title visible and controls clear of navigation. Text titles replace third-party title logos deliberately, allowing automatic weekly changes.
- Spacing/layout: Full-width cinematic hero, inset translucent pill navigation, left-aligned actions, lower carousel controls, six-column desktop and three-column mobile poster grid. Recent releases immediately follow the banner. Library, catalog shelves, manga, manhwa, and community remain below. The user's content-order request takes precedence over Anixo's community strip and three-column summary blocks.
- Colors: Near-black surfaces, restrained purple Yoru accents, white primary action, translucent navigation and secondary action, readable release badges. Stronger text-side shading than the reference improves title contrast.
- Imagery: Real AnimeSchedule posters and exact-ID Kitsu wide artwork. No synthetic anime assets, copied Anixo logos, or fake content. Portraits are composed as an intentional fallback where the provider has no wide artwork. Artwork source quality remains provider-dependent.
- Copy/content: Real current-week selections and rolling seven-day episode releases. Sub/dub filters and per-episode links are functional. Empty/unavailable states avoid claiming there are no episodes when the feed failed. Ranking attribution names AnimeSchedule.

## Validation

Live local data returned six weekly banner titles and eighteen English-sub releases with verified MAL anime links. Keyboard/accessible controls, carousel, language selection, exact episode links, and overflow were checked by desktop/mobile browser tests. An independent code reviewer found the mobile button label issue above and no other P1/P2 issue. Both Node and Sites backend suites passed; two unrelated Sites browser journeys initially encountered Chromium ERR_NO_BUFFER_SPACE and passed in the bounded single-worker rerun.

No remaining P0/P1/P2 findings. No new feature was substituted for the requested homepage work.

final result: passed
