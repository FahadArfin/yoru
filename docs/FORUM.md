# Community forums

Community adds permanent, member-created topics alongside the existing episode/chapter conversations. Boards cover Anime, Manga, Manhwa, Figures & Collecting, Recommendations, News & Releases, Fan Creations, General Lounge, and Site Feedback. Topic types distinguish questions, theories, news, showcases, and ordinary discussions.

The board directory leads to searchable, paginated topic rows with reply counts and last activity. Signed-in members create topics, reply, and edit their own post bodies. Spoiler bodies are hidden until revealed; thread titles should remain spoiler-free. Guests may browse. No fabricated topics or member activity are seeded.

Episode/chapter discussions retain their existing canonical media ID + unit identity, sharing comments with the watch/reader pages. A series lookup expands coverage beyond the recent-release feed. Release metadata determines available episodes; chapter directories supply released chapter numbers. Missing metadata is shown honestly.

New forum topics and replies use additive SQLite/D1 tables. All writes use the existing authentication, origin guard, rate limiting, and session revocation checks. Collection scope is stored and enforced on reads/writes, keeping Yoru and Ara Ara forum topics separate. Bodies render as text, never raw HTML. Pagination bounds requests. Existing comments and reviews are retained.

Research: https://anilist.co/forum/ separates anime, manga, release discussions, recommendations, news, and feedback. https://www.anime-planet.com/forum/forums/anime-recommendations.152/ dedicates a board to recommendations. https://myfigurecollection.net/club/ includes collection tips, figure care, and collecting communities. These inform the channels, not copied posts or branding.

Verification covers authentication and ownership, collection isolation, input validation, search/sort/pagination, persistence across Workers, spoiler controls, real creation/reply/edit flows on desktop/mobile, existing community/watch discussions, and the published guest experience.
