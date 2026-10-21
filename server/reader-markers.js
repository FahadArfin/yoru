import { apiError, numeric, text } from './validation.js';
import { accountAtomic, resolveAccountMedia } from './reading-account.js';

export function markerInput(input, owner) {
  if (input?.owner !== owner)
    throw apiError(409, 'Your account changed. Reload to save bookmarks.');
  const chapterId = text(input.chapterId, { name: 'Chapter edition', min: 1, max: 500 });
  const at = numeric(input.updatedAt, {
    name: 'Save time',
    min: 1,
    max: Date.now() + 60000,
    integer: true,
  });
  const bookmark = Object.hasOwn(input, 'bookmark');
  const read = Object.hasOwn(input, 'read');
  if (!bookmark && !read) throw apiError(400, 'Choose a bookmark or read status.');
  if (read && typeof input.read !== 'boolean')
    throw apiError(400, 'Read status must be true or false.');
  return {
    chapterId,
    at,
    bookmark,
    read,
    page:
      bookmark && input.bookmark !== null
        ? numeric(input.bookmark, { name: 'Bookmark page', min: 1, max: 10000, integer: true })
        : null,
    isRead: read ? Number(input.read) : null,
  };
}
export async function readerMarkers(id, input, userId, request) {
  const patch = input ? markerInput(input, userId) : null;
  const { context, media } = await resolveAccountMedia(
    id,
    patch?.chapterId,
    request.context,
    request.deps,
  );
  if (media.category === 'ANIME')
    throw apiError(400, 'Chapter bookmarks are for manga and manhwa.');
  const statements = patch
    ? [
        {
          sql: `INSERT INTO reader_markers(user_id,media_id,chapter_id,bookmark,bookmark_at,is_read,read_at)
      VALUES(?,?,?,?,?,?,?) ON CONFLICT(user_id,media_id,chapter_id) DO UPDATE SET
      bookmark=CASE WHEN excluded.bookmark_at>reader_markers.bookmark_at THEN excluded.bookmark ELSE reader_markers.bookmark END,
      bookmark_at=MAX(excluded.bookmark_at,reader_markers.bookmark_at),
      is_read=CASE WHEN excluded.read_at>reader_markers.read_at THEN excluded.is_read ELSE reader_markers.is_read END,
      read_at=MAX(excluded.read_at,reader_markers.read_at)`,
          values: [
            userId,
            id,
            patch.chapterId,
            patch.page,
            patch.bookmark ? patch.at : 0,
            patch.isRead,
            patch.read ? patch.at : 0,
          ],
        },
      ]
    : [];
  await accountAtomic(context, statements, request.deps, { media });
  const rows = await request.deps.db.all(
    'SELECT chapter_id,bookmark,bookmark_at,is_read,read_at FROM reader_markers WHERE user_id=? AND media_id=? ORDER BY chapter_id LIMIT 5000',
    userId,
    id,
  );
  return {
    chapters: Object.fromEntries(
      rows.map((row) => [
        row.chapter_id,
        {
          ...(row.bookmark_at ? { bookmark: row.bookmark, bookmarkAt: row.bookmark_at } : {}),
          ...(row.read_at ? { read: !!row.is_read, readAt: row.read_at } : {}),
        },
      ]),
    ),
  };
}
