import { getHome } from './home-core.js';
import { getChapterCalendar } from './chapter-calendar.js';

const validId = /^mal-(anime|manga)-[1-9]\d*$/;
const validUnit = (unit) => Number.isInteger(unit) && unit > 0 && unit <= 100000;
const categoryOf = (media) => String(media?.category || media?.type || '').toLowerCase();
const grouped = `SELECT media_id, unit, COUNT(*) AS comments, MAX(created_at) AS latest
  FROM comments WHERE unit > 0`;

// Threads are identities over the existing comments, not a second copy of them.
// A release can therefore have a thread before anyone posts its first comment.
export async function getCommunityThreads(input, options) {
  const {
    db,
    media: getMedia,
    now = Date.now(),
    home = getHome,
    chapters = getChapterCalendar,
  } = options;
  const category = ['anime', 'manga', 'manhwa'].includes(input.category) ? input.category : 'anime';
  const threads = new Map();
  const add = (media, unit, releasedAt) => {
    if (!validId.test(media?.id) || !validUnit(unit) || categoryOf(media) !== category) return;
    if (!Number.isFinite(Date.parse(releasedAt)) || Date.parse(releasedAt) > now) return;
    const id = `${media.id}:${unit}`;
    const existing = threads.get(id);
    if (existing) {
      if (releasedAt < existing.releasedAt) existing.releasedAt = releasedAt;
      return;
    }
    threads.set(id, { id, mediaId: media.id, media, unit, releasedAt, comments: 0, latest: null });
  };
  let releaseState = 'ready';
  try {
    if (category === 'anime') {
      const result = await home({ language: 'all' }, options);
      releaseState = result.stale ? 'stale' : result.state || 'ready';
      for (const release of result.releases || []) {
        if (!release.delayed) add(release.media, release.episode, release.airingAt);
      }
    } else {
      const results = await Promise.all(
        [0, 1].map((day) =>
          chapters(
            {
              category,
              language: 'all',
              timezone: 'UTC',
              date: new Date(now - day * 86400000).toISOString().slice(0, 10),
            },
            options,
          ),
        ),
      );
      for (const result of results) {
        if (result.state !== 'ready') releaseState = result.state;
        for (const release of result.items || []) {
          if (release.status !== 'released') continue;
          add(
            {
              id: release.mediaId,
              title: release.title,
              cover: release.cover,
              category: category.toUpperCase(),
              type: 'MANGA',
            },
            Number(release.chapter),
            release.publishedAt,
          );
        }
      }
    }
  } catch {
    releaseState = 'unavailable';
  }
  // Keep older conversations discoverable even after their release leaves the feed.
  const prefix = category === 'anime' ? 'mal-anime-%' : 'mal-manga-%';
  const active = await db.all(
    `${grouped} AND media_id LIKE ? GROUP BY media_id, unit ORDER BY latest DESC LIMIT 60`,
    prefix,
  );
  const known = new Map([...threads.values()].map((thread) => [thread.mediaId, thread.media]));
  const ids = [...new Set(active.map((row) => row.media_id))];
  // Bound catalog lookups and reuse metadata across episodes of the same title.
  for (let start = 0; start < ids.length; start += 4) {
    await Promise.all(
      ids
        .slice(start, start + 4)
        .filter((id) => !known.has(id))
        .map(async (id) => {
          known.set(id, await getMedia(id).catch(() => null));
        }),
    );
  }
  for (const row of active) add(known.get(row.media_id), Number(row.unit), row.latest);
  const mediaIds = [...new Set([...threads.values()].map((thread) => thread.mediaId))];
  // Exact counts, including replies, even when the latest comment is outside the active window.
  for (let start = 0; start < mediaIds.length; start += 30) {
    const batch = mediaIds.slice(start, start + 30);
    const rows = await db.all(
      `${grouped} AND media_id IN (${batch.map(() => '?').join(',')}) GROUP BY media_id, unit`,
      ...batch,
    );
    for (const row of rows) {
      const thread = threads.get(`${row.media_id}:${row.unit}`);
      if (thread) {
        thread.comments = Number(row.comments);
        thread.latest = row.latest;
      }
    }
  }
  return {
    category,
    releaseState,
    items: [...threads.values()].sort(
      (a, b) =>
        Date.parse(b.latest || b.releasedAt) - Date.parse(a.latest || a.releasedAt) ||
        a.id.localeCompare(b.id),
    ),
  };
}
