# Public community channels

Community has a Live chat view alongside Forums and Latest activity. Its channel browser supports search, pagination and channel creation. On phones, Browse channels switches between the browser and the conversation.

All channels and messages are public to readers, including signed-out visitors. Creating a channel or sending a message requires an active server session. Names are unique after normalization; descriptions are optional. There is no membership, invitation or private-channel setting.

General uses the existing public messages (`room_id IS NULL`, `channel_id IS NULL`) so old conversations remain available. Custom channels set `channel_id`. Room chat continues using its existing membership-protected routes and is excluded from all channel history queries. Legacy `/api/chat` excludes custom-channel messages.

The channel API is shared between Node/SQLite and Sites/D1. New migration 0015 adds the channel table, nullable message reference and indexes without rewriting existing messages. General is a built-in channel and needs no seed migration.

Messages use stable database insertion order and ID-based before/after cursors, with 50 messages per page. The active conversation polls for new messages every three seconds, catches up bounded pages after a disconnect, pauses while the browser tab is hidden, and aborts requests when switching channels. Sending displays the confirmed message immediately. Older messages load on demand without moving the reading position.

Writes derive authorship from the session. Atomic SQL limits each member to 10 created channels per day and 30 messages per minute. Existing same-origin checks and session revocation guards apply. Client text is rendered as plain text.

Validation covers channel isolation, preserved General history, guest reads/authenticated writes, revoked sessions, unique names, bounded history and browser pagination, rate limits, two-Worker persistence, two-reader updates, mobile navigation, and existing forum/watch-room journeys. Test conversations are created only in disposable test databases.
