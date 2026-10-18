# Phone experience audit and improvements

Audit date: October 18, 2026. Scope: Yoru's existing website, with desktop composition retained.

## Findings and implementation

| Journey                                | Observed friction                                                                                        | Implemented change                                                                                                                                                                                                            |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Open Home and move between sections | Six small navigation links and a narrow search field competed for the phone header.                      | A phone-only Home / Browse / Schedule / My Space bottom bar. Browse opens a focus-trapped sheet with Anime, Manga and Manhwa. Search gets its own full-width row.                                                             |
| 2. Search for a title                  | The suggestion panel could be wider than the narrow input. Labels and filter targets were small.         | Align the phone panel to the search field; use opaque theme surfaces, larger category controls and 16px inputs. Existing desktop alignment is retained.                                                                       |
| 3. Browse catalogs and featured titles | Three poster columns made titles and artwork difficult to scan. Large banners consumed the first screen. | Two poster columns up to 600px, shorter phone banners and visible 44px carousel arrows/pause. Slide dots are omitted on phones to prevent long carousels overflowing. Swipe/drag navigation is retained.                      |
| 4. Choose a release date               | Seven dates were squeezed into a narrow card.                                                            | Scrollable 66px date cards, larger labels and automatic horizontal reveal of the selected date. The document is not scrolled. This applies to anime and reading calendars; the homepage also keeps its selected date visible. |
| 5. Watch an episode                    | Playback and source controls were small.                                                                 | Larger playback, source and episode targets; more readable synopsis text. Existing release availability and playback behavior are preserved.                                                                                  |
| 6. Read manga/manhwa                   | The immersive reader was already effective.                                                              | Preserve the reader canvas and omit the site bottom bar. Enlarge menu/navigation/page controls and inputs.                                                                                                                    |
| 7. Browse Community and My Space       | Repeated introductory content pushed the forums far down the first phone screen.                         | Compact My Space heading and tabs, concise room shortcut and denser forum channel cards. Keep channel names/counts, existing discussion functionality and live chat.                                                          |
| 8. Use Library, Rooms and Settings     | Very narrow screens exposed horizontal overflow in Library actions and My Space tabs.                    | Wrap Library actions, allow text to wrap, and hide redundant tab icons at the narrowest breakpoint. Routes remain directly reachable.                                                                                         |

## Desktop protection

New presentation rules are isolated in `src/mobile.css` at 760px and below, with smaller-screen refinements at 600px and 360px. The phone navigation component renders nothing above 760px and closes its sheet when resized to desktop. Search geometry and calendar scrolling preserve the existing desktop behavior. No catalog, account, progress, forum or playback APIs are changed.

## Evidence and validation

The initial live audit used a 390 × 844 phone viewport, capturing Home, search suggestions, anime browsing, schedule, Community, forum channels, watch and reader states. Screenshots are stored locally under `.cache/mobile-audit/`; captures containing loading placeholders were excluded from visual conclusions. Additional narrow-screen checks identified and corrected 320px overflow.

`tests/e2e/mobile-layout.spec.js` covers 320, 390, 430 and 760px widths across Home, catalog, schedule, Community, Library, Rooms, Settings, title and watch routes. It checks horizontal overflow, navigation targets, field size, sheet dismissal/focus restoration, desktop resizing, search selection, calendar selection and reader isolation. Existing journeys cover account, room, discussion, catalog, release and reader behavior on desktop and mobile against disposable Node and Sites databases.

The reading-banner regression now targets the active artwork rather than the offscreen previous/next slides and respects the already-existing compact category hero. Navigation regressions exercise the actual phone sheet instead of the hidden desktop links.

These are browser-emulation and local integration checks, not tests on physical iOS/Android devices. External media, OAuth and provider availability are outside the deterministic suite; a loaded third-party player is not evidence of successful playback. Authentication tests use disposable accounts, not the owner's live account.

## Design references

- [W3C: Target Size (Minimum)](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum) describes minimum target dimensions and spacing. Primary phone controls here aim for at least 44px height; this is not a claim of complete WCAG conformance.
- [web.dev: Learn Responsive Design](https://web.dev/learn/design) supports adapting layout and input affordances to the available device space rather than compressing a desktop interface.
