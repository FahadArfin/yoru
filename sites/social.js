import { randomUUID } from 'node:crypto';
import { getMedia, rememberImportedMedia } from '../server/catalog-core.js';
import { apiError, text, numeric, mediaId, bool } from '../server/validation.js';
import { requireAuth, publicUser } from './security.js';
import { now, eventStatement, changes, liveSession, sessionValues } from './store.js';
import { commentMediaError } from '../shared/comment-media.js';

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
  app.get('/api/library', requireAuth, async (c) => {
    const entries = await c
      .get('db')
      .all(
        'SELECT library.*,imported_media.metadata FROM library LEFT JOIN imported_media ON imported_media.media_id=library.media_id WHERE user_id=? ORDER BY updated_at DESC LIMIT 5000',
        c.get('user').id,
      );
    rememberImportedMedia(entries.filter((x) => x.metadata).map((x) => JSON.parse(x.metadata)));
    return c.json({
      items: await Promise.all(
        entries.map(async (row) => libraryShape(row, await getMedia(row.media_id))),
      ),
    });
  });
  app.put('/api/library/:mediaId', requireAuth, async (c) => {
    const id = mediaId(c.req.param('mediaId')),
      input = await c.req.json(),
      db = c.get('db'),
      user = c.get('user');
    const media = await getMedia(id);
    if (!media) throw apiError(404, 'This title could not be found.');
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
    const result = await db.batch([
      db.statement(
        `INSERT INTO library(user_id,media_id,favorite,status,progress,score,updated_at) SELECT ?,?,?,?,?,?,? WHERE ${liveSession}
        ON CONFLICT(user_id,media_id) DO UPDATE SET
        favorite=CASE WHEN ? THEN excluded.favorite ELSE library.favorite END,
        status=CASE WHEN ? THEN excluded.status ELSE library.status END,
        progress=CASE WHEN ? THEN excluded.progress ELSE library.progress END,
        score=CASE WHEN ? THEN excluded.score ELSE library.score END,updated_at=excluded.updated_at RETURNING *`,
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
      ),
      eventStatement(db, 'library', { userId: user.id, mediaId: id }, { userId: user.id }),
    ]);
    if (!result[0].results.length) throw apiError(401, 'Your session changed. Sign in again.');
    return c.json({ item: libraryShape(result[0].results[0], media) });
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
      db = c.get('db'),
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
    const db = c.get('db'),
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
    const unit = numeric(Number(c.req.query('unit') || 0), {
      name: 'Episode or chapter',
      integer: true,
    });
    return c.json({
      items: (
        await c
          .get('db')
          .all(
            `${COMMENT_QUERY} WHERE media_id=? AND unit=? ORDER BY comments.created_at DESC LIMIT 500`,
            c.get('user')?.id || '',
            c.req.param('mediaId'),
            unit,
          )
      ).map(commentShape),
    });
  });
  app.post('/api/comments/:mediaId', requireAuth, async (c) => {
    const input = await c.req.json(),
      db = c.get('db'),
      userId = c.get('user').id,
      id = mediaId(c.req.param('mediaId'));
    const unit = numeric(Number(input.unit ?? c.req.query('unit') ?? 0), {
      name: 'Episode or chapter',
      integer: true,
    });
    const body = text(input.body ?? input.text, { name: 'Comment', min: 1, max: 5000 }),
      parentId = input.parentId || null;
    const mediaError = commentMediaError(body);
    if (mediaError) throw apiError(400, mediaError);
    if (parentId) {
      let ancestor = await db.get(
        'SELECT * FROM comments WHERE id=? AND media_id=? AND unit=?',
        typeof parentId === 'string' ? parentId : '',
        id,
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
        'INSERT INTO comments(id,user_id,media_id,unit,parent_id,body,spoiler,created_at) VALUES(?,?,?,?,?,?,?,?)',
        commentId,
        userId,
        id,
        unit,
        parentId,
        body,
        Number(spoiler),
        now(),
      ),
      eventStatement(db, 'comments', { mediaId: id, unit }),
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
      db = c.get('db'),
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
    const db = c.get('db'),
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
  app.get('/api/community', async (c) => {
    const db = c.get('db');
    const comments = (
      await db.all(`${COMMENT_QUERY} ORDER BY comments.created_at DESC LIMIT 20`, '')
    ).map((x) => ({ ...commentShape(x), kind: 'comment', type: 'comment' }));
    const reviews =
      c.req.query('type') === 'comment'
        ? []
        : (await db.all(`${REVIEW_QUERY} ORDER BY updated_at DESC LIMIT 20`)).map((x) => ({
            ...reviewShape(x),
            kind: 'review',
            type: 'review',
          }));
    return c.json({
      items: await Promise.all(
        [...comments, ...reviews]
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
          .slice(0, 24)
          .map(async (x) => ({ ...x, media: await getMedia(x.mediaId) })),
      ),
      online: await onlineState(db),
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
