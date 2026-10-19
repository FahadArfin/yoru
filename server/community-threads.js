import { getHome } from './home-core.js';
import { getChapterCalendar } from './chapter-calendar.js';
import { parseMediaReference } from '../shared/media-reference.js';
import { createExternalCatalogStore } from './external-catalog-store.js';
import { commentReadingPredicate } from './native-social-policy.js';
import { discussionKey } from '../shared/native-social-contract.js';

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
  const add = (media, unit, releasedAt, conversation = false, editionId = null) => {
    const native = parseMediaReference(media?.id)?.kind === 'extension-manga';
    if (
      (!validId.test(media?.id) && !native) ||
      !(
        validUnit(unit) ||
        (conversation && options.policy && (unit === 0 || (native && editionId)))
      ) ||
      categoryOf(media) !== category
    )
      return;
    if (!conversation && (!Number.isFinite(Date.parse(releasedAt)) || Date.parse(releasedAt) > now))
      return;
    const id = discussionKey({ mediaId: media.id, unit, editionId });
    const existing = threads.get(id);
    if (existing) {
      if (releasedAt < existing.releasedAt) existing.releasedAt = releasedAt;
      return;
    }
    threads.set(id, {
      id,
      mediaId: media.id,
      media,
      unit,
      editionId,
      releasedAt,
      comments: 0,
      latest: null,
    });
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
  let page;
  const active = options.policy
    ? (page = await options.policy.select({
        candidates: `SELECT media_id,unit,edition_id,media_id||':'||COALESCE(edition_id,unit) AS social_id,COUNT(*) AS comments,MAX(created_at) AS latest FROM comments WHERE unit>=0 GROUP BY media_id,COALESCE(edition_id,unit)`,
        where: `json_extract(policy.value,'$.category')=? AND ${commentReadingPredicate}`,
        values: [category.toUpperCase()],
        scope: [category],
        orderBy: [
          ['latest', 'DESC'],
          ['social_id', 'ASC'],
        ],
        limit: 60,
      })).rows
    : await db.all(
        `${grouped} AND media_id LIKE ? GROUP BY media_id, unit ORDER BY latest DESC LIMIT 60`,
        prefix,
      );
  const known = new Map([...threads.values()].map((thread) => [thread.mediaId, thread.media]));
  if (options.policy) {
    const released = await options.policy.mediaBatch([...known.keys()]);
    for (const [id, thread] of threads) {
      if (!released.has(thread.mediaId)) threads.delete(id);
      else thread.media = released.get(thread.mediaId);
    }
    known.clear();
    for (const [id, item] of released) known.set(id, item);
    for (const [id, item] of page.mediaById) known.set(id, item);
  }
  const ids = [...new Set(active.map((row) => row.media_id))];
  // Bound catalog lookups and reuse metadata across episodes of the same title.
  for (let start = 0; !options.policy && start < ids.length; start += 4) {
    await Promise.all(
      ids
        .slice(start, start + 4)
        .filter((id) => !known.has(id))
        .map(async (id) => {
          known.set(id, await getMedia(id).catch(() => null));
        }),
    );
  }
  for (const row of active) {
    const native = parseMediaReference(row.media_id)?.kind === 'extension-manga';
    add(
      known.get(row.media_id),
      Number(row.unit),
      native ? null : row.latest,
      Boolean(options.policy) || native,
      row.edition_id || null,
    );
    const thread = threads.get(
      discussionKey({ mediaId: row.media_id, unit: row.unit, editionId: row.edition_id }),
    );
    if (thread) {
      thread.comments = Number(row.comments);
      thread.latest = row.latest;
    }
  }
  const mediaIds = [...new Set([...threads.values()].map((thread) => thread.mediaId))];
  // Exact counts, including replies, even when the latest comment is outside the active window.
  for (let start = 0; start < mediaIds.length; start += 30) {
    const batch = mediaIds.slice(start, start + 30);
    const rows = await db.all(
      `${grouped} ${options.policy ? 'AND edition_id IS NULL' : ''} AND media_id IN (${batch.map(() => '?').join(',')}) GROUP BY media_id, unit`,
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
  if (options.policy) {
    const store = createExternalCatalogStore(options.policy.deps.db, options.policy.deps);
    for (const thread of [...threads.values()]) {
      if (!thread.editionId && thread.unit !== 0) continue;
      const reference = thread.editionId || thread.mediaId;
      for (const mapping of await store.getEquivalences(reference)) {
        const otherId = mapping.leftId === reference ? mapping.rightId : mapping.leftId;
        const other = thread.editionId
          ? [...threads.values()].find((item) => item.editionId === otherId)
          : threads.get(`${otherId}:0`);
        if (!other || other === thread || !threads.has(thread.id)) continue;
        const [keep, remove] = [thread, other].sort((a, b) => a.id.localeCompare(b.id));
        keep.discussions = [
          ...(keep.discussions || [
            { mediaId: keep.mediaId, unit: keep.unit, editionId: keep.editionId },
          ]),
          ...(remove.discussions || [
            { mediaId: remove.mediaId, unit: remove.unit, editionId: remove.editionId },
          ]),
        ];
        keep.comments += remove.comments;
        if (remove.latest > keep.latest) keep.latest = remove.latest;
        threads.delete(remove.id);
      }
    }
  }
  return {
    category,
    releaseState,
    ...(page
      ? {
          complete: page.complete,
          nextCursor: page.nextCursor,
          nextSourceCursor: page.nextSourceCursor,
          sourceStates: page.sourceStates,
          selectionFingerprint: page.selectionFingerprint,
        }
      : {}),
    items: [...threads.values()].sort(
      (a, b) =>
        Date.parse(b.latest || b.releasedAt) - Date.parse(a.latest || a.releasedAt) ||
        a.id.localeCompare(b.id),
    ),
  };
}
