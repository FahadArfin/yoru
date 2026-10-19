import { randomUUID } from 'node:crypto';
import { getMedia, coreAccountMedia } from '../server/catalog-core.js';
import { apiError, text, numeric, mediaId, bool } from '../server/validation.js';
import { requireAuth, publicUser } from './security.js';
import {
  now,
  eventStatement,
  changes,
  liveSession,
  sessionValues,
  sitesReaderDb,
} from './store.js';
import { commentMediaError } from '../shared/comment-media.js';
import { getCommunityThreads } from '../server/community-threads.js';
import { scheduleOptions } from './schedule-storage.js';
import { isOffline } from './catalog-storage.js';
import { resumeInput, resumeUpsert } from '../server/resume.js';
import { forumRoutes } from './forum.js';
import { resolveReaderContext } from '../server/reader-context.js';
import { createExtensionGateway } from '../server/extension-gateway.js';
import { socialRequest, socialDatabase } from './native-social.js';
import { commentReadingPredicate } from '../server/native-social-policy.js';
import {
  listReadingLibrary,
  listReadingResume,
  resolveAccountMedia,
  accountAtomic,
  accountSnapshotStatement,
  resumeMetadata,
  exportReadingAccount,
} from '../server/reading-account.js';

async function accountRequest(c) {
  const db = sitesReaderDb(c.get('db'));
  const context = await resolveReaderContext(c.req.query(), {
    db,
    userId: c.get('user').id,
    sessionHash: c.get('sessionHash'),
    extensionsEnabled: c.env.READER_EXTENSIONS_ENABLED,
    signal: c.req.raw.signal,
  });
  return {
    context,
    deps: {
      db,
      coreMedia: getMedia,
      coreAccountMedia,
      bridge: createExtensionGateway({
        ...scheduleOptions(c.env),
        bridgeUrl: c.env.READER_BRIDGE_URL,
        bridgeKey: c.env.READER_BRIDGE_KEY,
        extensionsEnabled: c.env.READER_EXTENSIONS_ENABLED,
      }),
    },
  };
}

const author = (row) => ({ id: row.user_id, name: row.name, avatar: row.avatar || '' });
export const libraryShape = (row, media) => ({
  mediaId: row.media_id,
  media,
  favorite: Boolean(row.favorite),
  status: row.status,
  progress: row.progress,
  score: row.score,
  updatedAt: row.updated_at,
});
const reviewShape = (row) => ({
  id: row.id,
  mediaId: row.media_id,
  userId: row.user_id,
  author: author(row),
  title: row.title,
  body: row.body,
  rating: row.rating,
  spoiler: Boolean(row.spoiler),
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});
const commentShape = (row) => ({
  id: row.id,
  mediaId: row.media_id,
  unit: row.unit,
  editionId: row.edition_id || null,
  parentId: row.parent_id,
  userId: row.user_id,
  author: author(row),
  body: row.body,
  text: row.body,
  spoiler: Boolean(row.spoiler),
  score: row.score || 0,
  votes: row.score || 0,
  likes: row.likes || 0,
  dislikes: row.dislikes || 0,
  viewerVote: row.viewer_vote || 0,
  createdAt: row.created_at,
});
export const messageShape = (row) => ({
  id: row.id,
  roomId: row.room_id,
  body: row.body,
  text: row.body,
  author: author(row),
  userId: row.user_id,
  createdAt: row.created_at,
});
const REVIEW_QUERY =
  'SELECT reviews.*,users.name,users.avatar FROM reviews JOIN users ON users.id=reviews.user_id';
const COMMENT_QUERY = `SELECT comments.*,users.name,users.avatar,
  (SELECT COUNT(*) FROM comment_votes WHERE comment_id=comments.id AND value=1) AS likes,
  (SELECT COUNT(*) FROM comment_votes WHERE comment_id=comments.id AND value=-1) AS dislikes,
  COALESCE((SELECT SUM(value) FROM comment_votes WHERE comment_id=comments.id),0) AS score,
  COALESCE((SELECT value FROM comment_votes WHERE comment_id=comments.id AND user_id=?),0) AS viewer_vote
  FROM comments JOIN users ON users.id=comments.user_id`;
export const MESSAGE_QUERY =
  'SELECT messages.*,users.name,users.avatar FROM messages JOIN users ON users.id=messages.user_id';
export async function messages(db, roomId = null) {
  return (
    await db.all(
      `${MESSAGE_QUERY} WHERE room_id IS ? ORDER BY messages.created_at DESC LIMIT 100`,
      roomId,
    )
  )
    .reverse()
    .map(messageShape);
}
export async function onlineState(db) {
  const users = (
    await db.all(
      `SELECT DISTINCT users.id,users.name,users.avatar,users.created_at FROM presence_leases
    JOIN sessions ON sessions.token_hash=presence_leases.session_hash JOIN users ON users.id=presence_leases.user_id
    WHERE presence_leases.expires_at>? AND sessions.expires_at>? ORDER BY users.name LIMIT 100`,
      Date.now(),
      Date.now(),
    )
  ).map(publicUser);
  return { count: users.length, users };
}
export function socialRoutes(app) {
  forumRoutes(app);
  app.get('/api/resume', requireAuth, async (c) => {
    const { context, deps } = await accountRequest(c);
    c.header('Cache-Control', 'no-store');
    return c.json(await listReadingResume(context, c.req.query(), deps));
  });
  app.put('/api/resume/:mediaId', requireAuth, async (c) => {
    const id = mediaId(c.req.param('mediaId')),
      user = c.get('user'),
      db = c.get('db');
    const input = await c.req.json(),
      request = await accountRequest(c);
    const { context, media } = await resolveAccountMedia(
      id,
      input.chapterId,
      request.context,
      request.deps,
    );
    const item = { ...resumeInput(input, media, user.id), ...resumeMetadata(media, context) };
    await accountAtomic(
      context,
      [
        { sql: resumeUpsert, values: [user.id, id, JSON.stringify(item), item.updatedAt] },
        accountSnapshotStatement(context, media, 'resume', item),
      ],
      request.deps,
      { media },
    );
    return c.json({
      item: JSON.parse(
        (
          await db.get(
            'SELECT payload FROM resume_progress WHERE user_id=? AND media_id=?',
            user.id,
            id,
          )
        ).payload,
      ),
    });
  });
  app.get('/api/library/export', requireAuth, async (c) => {
    const { context, deps } = await accountRequest(c);
    c.header('Cache-Control', 'no-store');
    return c.json(await exportReadingAccount(context, deps));
  });
  app.get('/api/library', requireAuth, async (c) => {
    const { context, deps } = await accountRequest(c);
    c.header('Cache-Control', 'no-store');
    return c.json(await listReadingLibrary(context, c.req.query(), deps));
  });
  app.put('/api/library/:mediaId', requireAuth, async (c) => {
    const id = mediaId(c.req.param('mediaId')),
      input = await c.req.json(),
      db = c.get('db'),
      user = c.get('user');
    const request = await accountRequest(c);
    const { context, media } = await resolveAccountMedia(id, null, request.context, request.deps);
    if (
      input.status !== undefined &&
      !['planned', 'watching', 'reading', 'completed', 'paused', 'dropped'].includes(input.status)
    )
      throw apiError(400, 'Choose a valid list status.');
    const favorite = input.favorite === undefined ? 0 : Number(bool(input.favorite, 'Favorite'));
    const progress =
      input.progress === undefined ? 0 : numeric(input.progress, { name: 'Progress' });
    const score =
      input.score === undefined || input.score === null
        ? null
        : numeric(input.score, { name: 'Score', max: 10 });
    const result = await accountAtomic(
      context,
      [
        {
          sql: `INSERT INTO library(user_id,media_id,favorite,status,progress,score,updated_at) SELECT ?,?,?,?,?,?,? WHERE ${liveSession}
        ON CONFLICT(user_id,media_id) DO UPDATE SET
        favorite=CASE WHEN ? THEN excluded.favorite ELSE library.favorite END,
        status=CASE WHEN ? THEN excluded.status ELSE library.status END,
        progress=CASE WHEN ? THEN excluded.progress ELSE library.progress END,
        score=CASE WHEN ? THEN excluded.score ELSE library.score END,updated_at=excluded.updated_at RETURNING *`,
          values: [
            user.id,
            id,
            favorite,
            input.status || 'planned',
            progress,
            score,
            now(),
            ...sessionValues(c),
            Number(input.favorite !== undefined),
            Number(input.status !== undefined),
            Number(input.progress !== undefined),
            Number(input.score !== undefined),
          ],
        },
        accountSnapshotStatement(context, media),
        {
          sql: 'INSERT INTO event_log(event,payload,room_id,user_id,created_at) VALUES(?,?,NULL,?,?)',
          values: [
            'library',
            JSON.stringify({ userId: user.id, mediaId: id }),
            user.id,
            Date.now(),
          ],
        },
      ],
      request.deps,
      { media },
    );
    if (!result[0].length) throw apiError(401, 'Your session changed. Sign in again.');
    return c.json({ item: libraryShape(result[0][0], media) });
  });
  app.delete('/api/library/:mediaId', requireAuth, async (c) => {
    const db = c.get('db'),
      userId = c.get('user').id,
      id = c.req.param('mediaId');
    await db.batch([
      db.statement('DELETE FROM library WHERE user_id=? AND media_id=?', userId, id),
      eventStatement(db, 'library', { userId, mediaId: id }, { userId }),
    ]);
    return c.json({ ok: true });
  });
  app.get('/api/reviews/:mediaId', async (c) =>
    c.json({
      items: (
        await c
          .get('db')
          .all(
            `${REVIEW_QUERY} WHERE media_id=? ORDER BY updated_at DESC LIMIT 100`,
            c.req.param('mediaId'),
          )
      ).map(reviewShape),
    }),
  );
  app.post('/api/reviews/:mediaId', requireAuth, async (c) => {
    const input = await c.req.json(),
      db = await socialDatabase(c),
      userId = c.get('user').id,
      id = mediaId(c.req.param('mediaId'));
    const body = text(input.body, { name: 'Review', min: 10, max: 10000 }),
      title = text(input.title || '', { name: 'Title', max: 120 });
    const rating = numeric(input.rating, { name: 'Rating', min: 1, max: 10, integer: true }),
      spoiler = input.spoiler === undefined ? false : bool(input.spoiler, 'Spoiler');
    const existing = await db.get(
      'SELECT id FROM reviews WHERE user_id=? AND media_id=?',
      userId,
      id,
    );
    await db.batch([
      db.statement(
        `INSERT INTO reviews(id,user_id,media_id,rating,title,body,spoiler,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)
      ON CONFLICT(user_id,media_id) DO UPDATE SET rating=excluded.rating,title=excluded.title,body=excluded.body,spoiler=excluded.spoiler,updated_at=excluded.updated_at`,
        randomUUID(),
        userId,
        id,
        rating,
        title,
        body,
        Number(spoiler),
        now(),
        now(),
      ),
      eventStatement(db, 'reviews', { mediaId: id }),
    ]);
    return c.json(
      {
        review: reviewShape(
          await db.get(`${REVIEW_QUERY} WHERE reviews.user_id=? AND media_id=?`, userId, id),
        ),
      },
      existing ? 200 : 201,
    );
  });
  app.delete('/api/reviews/:id', requireAuth, async (c) => {
    const db = await socialDatabase(c),
      review = await db.get(
        'DELETE FROM reviews WHERE id=? AND user_id=? RETURNING media_id',
        c.req.param('id'),
        c.get('user').id,
      );
    if (!review) throw apiError(404, 'Review not found.');
    await db.run(
      'INSERT INTO event_log(event,payload,created_at) VALUES(?,?,?)',
      'reviews',
      JSON.stringify({ mediaId: review.media_id }),
      Date.now(),
    );
    return c.json({ ok: true });
  });
  app.get('/api/comments/:mediaId', async (c) => {
    const { unit, editionId } = c.get('socialAccess').discussion;
    return c.json({
      items: (
        await c
          .get('db')
          .all(
            `${COMMENT_QUERY} WHERE media_id=? AND edition_id IS ? AND (? IS NOT NULL OR unit=?) ORDER BY comments.created_at DESC LIMIT 500`,
            c.get('user')?.id || '',
            c.req.param('mediaId'),
            editionId,
            editionId,
            unit,
          )
      ).map(commentShape),
    });
  });
  app.post('/api/comments/:mediaId', requireAuth, async (c) => {
    const input = await c.req.json(),
      db = await socialDatabase(c),
      userId = c.get('user').id,
      id = mediaId(c.req.param('mediaId'));
    const { unit, editionId } = c.get('socialAccess').discussion;
    const body = text(input.body ?? input.text, { name: 'Comment', min: 1, max: 5000 }),
      parentId = input.parentId || null;
    const mediaError = commentMediaError(body);
    if (mediaError) throw apiError(400, mediaError);
    if (parentId) {
      let ancestor = await db.get(
        'SELECT * FROM comments WHERE id=? AND media_id=? AND edition_id IS ? AND (? IS NOT NULL OR unit=?)',
        typeof parentId === 'string' ? parentId : '',
        id,
        editionId,
        editionId,
        unit,
      );
      if (!ancestor) throw apiError(400, 'Reply to a comment in this discussion.');
      let depth = 1;
      while (ancestor?.parent_id && depth < 5) {
        ancestor = await db.get('SELECT parent_id FROM comments WHERE id=?', ancestor.parent_id);
        depth++;
      }
      if (depth >= 5) throw apiError(400, 'This reply thread has reached its nesting limit.');
    }
    const spoiler = input.spoiler === undefined ? false : bool(input.spoiler, 'Spoiler'),
      commentId = randomUUID();
    await db.batch([
      db.statement(
        'INSERT INTO comments(id,user_id,media_id,unit,edition_id,parent_id,body,spoiler,created_at) VALUES(?,?,?,?,?,?,?,?,?)',
        commentId,
        userId,
        id,
        unit,
        editionId,
        parentId,
        body,
        Number(spoiler),
        now(),
      ),
      eventStatement(db, 'comments', { mediaId: id, unit, editionId }),
    ]);
    return c.json(
      {
        comment: commentShape(
          await db.get(`${COMMENT_QUERY} WHERE comments.id=?`, userId, commentId),
        ),
      },
      201,
    );
  });
  app.post('/api/comments/:id/vote', requireAuth, async (c) => {
    const input = await c.req.json(),
      db = await socialDatabase(c),
      userId = c.get('user').id;
    const value = numeric(input.value, { name: 'Vote', min: -1, max: 1, integer: true });
    const comment = await db.get('SELECT * FROM comments WHERE id=?', c.req.param('id'));
    if (!comment) throw apiError(404, 'Comment not found.');
    await db.batch([
      value === 0
        ? db.statement(
            'DELETE FROM comment_votes WHERE comment_id=? AND user_id=?',
            comment.id,
            userId,
          )
        : db.statement(
            'INSERT INTO comment_votes(comment_id,user_id,value) VALUES(?,?,?) ON CONFLICT(comment_id,user_id) DO UPDATE SET value=excluded.value',
            comment.id,
            userId,
            value,
          ),
      eventStatement(db, 'comments', { mediaId: comment.media_id, unit: comment.unit }),
    ]);
    return c.json({
      comment: commentShape(
        await db.get(`${COMMENT_QUERY} WHERE comments.id=?`, userId, comment.id),
      ),
    });
  });
  app.delete('/api/comments/:id', requireAuth, async (c) => {
    const db = await socialDatabase(c),
      row = await db.get(
        'DELETE FROM comments WHERE id=? AND user_id=? RETURNING media_id,unit',
        c.req.param('id'),
        c.get('user').id,
      );
    if (!row) throw apiError(404, 'Comment not found.');
    await db.run(
      'INSERT INTO event_log(event,payload,created_at) VALUES(?,?,?)',
      'comments',
      JSON.stringify({ mediaId: row.media_id, unit: row.unit }),
      Date.now(),
    );
    return c.json({ ok: true });
  });
  app.get('/api/community/threads', async (c) =>
    c.json(
      await getCommunityThreads(c.req.query(), {
        ...scheduleOptions(c.env),
        offline: isOffline(),
        db: c.get('db'),
        media: getMedia,
        policy: await socialRequest(c),
      }),
    ),
  );
  app.get('/api/community', async (c) => {
    const db = c.get('db'),
      policy = await socialRequest(c);
    const page = await policy.select({
      candidates: `SELECT id AS social_id,media_id,unit,edition_id,created_at AS social_sort,'comment' AS kind FROM comments
        ${c.req.query('type') === 'comment' ? '' : "UNION ALL SELECT id AS social_id,media_id,0 AS unit,NULL AS edition_id,created_at AS social_sort,'review' AS kind FROM reviews"}`,
      where: `(a.kind='review' OR ${commentReadingPredicate})`,
      scope: [c.req.query('type') === 'comment' ? 'comment' : 'all'],
      limit: 24,
    });
    const items = await Promise.all(
      page.rows.map(async (row) => {
        const item =
          row.kind === 'comment'
            ? commentShape(
                await db.get(
                  `${COMMENT_QUERY} WHERE comments.id=?`,
                  c.get('user')?.id || '',
                  row.social_id,
                ),
              )
            : reviewShape(await db.get(`${REVIEW_QUERY} WHERE reviews.id=?`, row.social_id));
        return { ...item, kind: row.kind, type: row.kind, media: page.mediaById.get(row.media_id) };
      }),
    );
    return c.json({
      items,
      online: await onlineState(db),
      complete: page.complete,
      nextCursor: page.nextCursor,
      nextSourceCursor: page.nextSourceCursor,
      sourceStates: page.sourceStates,
    });
  });
  app.get('/api/online', async (c) => c.json(await onlineState(c.get('db'))));
  app.get('/api/chat', async (c) => c.json({ items: await messages(c.get('db')) }));
  app.post('/api/chat', requireAuth, async (c) => {
    const input = await c.req.json(),
      db = c.get('db'),
      user = c.get('user');
    const body = text(input.body ?? input.text, { name: 'Message', min: 1, max: 2000 }),
      id = randomUUID(),
      timestamp = now();
    const message = {
      id,
      roomId: null,
      body,
      text: body,
      author: publicUser(user),
      userId: user.id,
      createdAt: timestamp,
    };
    await db.batch([
      db.statement(
        'INSERT INTO messages(id,user_id,room_id,body,created_at) VALUES(?,?,NULL,?,?)',
        id,
        user.id,
        body,
        timestamp,
      ),
      eventStatement(db, 'chat', { message, roomId: null }),
    ]);
    return c.json({ message }, 201);
  });
}
