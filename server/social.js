import { getAraCatalog } from '../server/ara-ara.js';
import { roomReaderPath, readerAtUnit } from '../shared/room-reader.js';
import { Router } from 'express';
import { randomBytes, randomUUID } from 'node:crypto';
import { all, get, run, transaction, now } from './db.js';
import {
  apiError,
  asyncRoute,
  cookie,
  authEvents,
  hashToken,
  mediaId,
  numeric,
  publicUser,
  requireAuth,
  text,
} from './auth.js';
import { getMedia } from './catalog.js';
import { touchVisitor, PRESENCE_COOKIE } from './visitor-presence.js';
import { commentMediaError } from '../shared/comment-media.js';

export const socialRouter = Router();
socialRouter.post(
  '/presence',
  asyncRoute(async (req, res) => {
    const result = await touchVisitor(
      { all, get, run },
      req.body,
      cookie(req, PRESENCE_COOKIE),
      req.user,
      req.sessionHash,
    );
    if (result.visitor !== cookie(req, PRESENCE_COOKIE))
      res.cookie(PRESENCE_COOKIE, result.visitor, {
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
        secure: process.env.NODE_ENV === 'production' && process.env.COOKIE_SECURE !== 'false',
      });
    res.json(result.online);
  }),
);
const connections = new Set();
const PRESENCE_TTL = 90_000;
const STATUS = new Set(['planned', 'watching', 'reading', 'completed', 'paused', 'dropped']);
const MEDIA_SQL = 'SELECT users.id,users.name,users.avatar,users.created_at FROM users';
const author = (row) => ({ id: row.user_id, name: row.name, avatar: row.avatar || '' });
const onlineUsers = () => {
  const unique = new Map();
  for (const connection of connections)
    if (connection.user && !connection.res.writableEnded && sessionAlive(connection))
      unique.set(connection.user.id, publicUser(connection.user));
  return [...unique.values()];
};
export const onlineState = () => {
  const users = onlineUsers();
  return { count: users.length, users };
};
function emit(connection, event, data) {
  if (connection.res.writableLength > 512 * 1024) {
    disconnect(connection);
    return;
  }
  if (!sessionAlive(connection)) {
    disconnect(connection);
    return;
  }
  if (
    connection.roomId &&
    ['room', 'chat', 'snapshot'].includes(event) &&
    !activeMember(connection.roomId, connection.user?.id)
  ) {
    disconnect(connection);
    return;
  }
  if (!connection.res.writableEnded)
    connection.res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}
function sessionAlive(connection) {
  return (
    !connection.user ||
    get(
      'SELECT user_id FROM sessions WHERE token_hash=? AND expires_at>?',
      connection.sessionHash,
      Date.now(),
    )
  );
}
function disconnect(connection) {
  if (connection.interval) clearInterval(connection.interval);
  connections.delete(connection);
  connection.res.end();
}
export function broadcast(event, data, roomId = null) {
  for (const connection of connections) {
    if (roomId && connection.roomId !== roomId) continue;
    if (event === 'library' && connection.user?.id !== data.userId) continue;
    emit(connection, event, data);
  }
}
function checkedRoom(id) {
  const room = get('SELECT * FROM rooms WHERE id=? AND closed_at IS NULL', id);
  if (!room) throw apiError(404, 'This room is no longer available.');
  return room;
}
function activeMember(roomId, userId) {
  return (
    userId &&
    get(
      'SELECT * FROM room_members WHERE room_id=? AND user_id=? AND last_seen>?',
      roomId,
      userId,
      Date.now() - PRESENCE_TTL,
    )
  );
}
function touchMember(roomId, userId) {
  if (userId)
    run(
      'UPDATE room_members SET last_seen=? WHERE room_id=? AND user_id=?',
      Date.now(),
      roomId,
      userId,
    );
}
function members(roomId) {
  return all(
    'SELECT users.id,users.name,users.avatar,room_members.joined_at FROM room_members JOIN users ON users.id=room_members.user_id WHERE room_id=? AND last_seen>? ORDER BY joined_at',
    roomId,
    Date.now() - PRESENCE_TTL,
  ).map((user) => ({
    id: user.id,
    name: user.name,
    avatar: user.avatar || '',
    joinedAt: user.joined_at,
  }));
}
function roomShape(room, viewerId) {
  const present = members(room.id);
  const joined = present.some((member) => member.id === viewerId);
  return {
    id: room.id,
    name: room.name,
    mediaId: room.media_id,
    type: room.type,
    visibility: room.visibility,
    hostId: room.host_id,
    host: publicUser(get(`${MEDIA_SQL} WHERE users.id=?`, room.host_id)),
    capacity: room.capacity,
    members: present,
    memberCount: present.length,
    joined,
    unit: room.unit,
    paused: Boolean(room.paused),
    position: room.position,
    sourceUrl: joined ? room.source_url : '',
    sourceKind: room.source_kind,
    version: room.version,
    stateUpdatedAt: room.state_updated_at,
    updatedAt: room.state_updated_at,
    createdAt: room.created_at,
  };
}
async function enrichedRoom(room, viewerId) {
  return { ...roomShape(room, viewerId), media: await getMedia(room.media_id) };
}
function notifyRoom(roomId) {
  const room = get('SELECT * FROM rooms WHERE id=? AND closed_at IS NULL', roomId);
  for (const connection of connections) {
    if (connection.roomId !== roomId) continue;
    emit(connection, 'room', { room: room ? roomShape(room, connection.user?.id) : null, roomId });
  }
  broadcast('rooms', { changed: true });
}
function requireMember(req, room) {
  if (!activeMember(room.id, req.user?.id)) throw apiError(403, 'Join this room to take part.');
  touchMember(room.id, req.user.id);
}
function departRoom(roomId, userId) {
  const room = get('SELECT * FROM rooms WHERE id=? AND closed_at IS NULL', roomId);
  if (!room) return;
  transaction(() => {
    run('DELETE FROM room_members WHERE room_id=? AND user_id=?', room.id, userId);
    if (room.host_id === userId) {
      const next = members(room.id)[0];
      if (next) run('UPDATE rooms SET host_id=?,version=version+1 WHERE id=?', next.id, room.id);
      else run('UPDATE rooms SET closed_at=? WHERE id=?', now(), room.id);
    }
  });
  notifyRoom(room.id);
}
authEvents.on('session-revoked', ({ tokenHash, userId }) => {
  const affectedRooms = new Set();
  for (const connection of connections) {
    if (connection.sessionHash !== tokenHash) continue;
    if (connection.roomId) affectedRooms.add(connection.roomId);
    disconnect(connection);
  }
  if (
    userId &&
    !get('SELECT token_hash FROM sessions WHERE user_id=? AND expires_at>?', userId, Date.now())
  ) {
    for (const member of all('SELECT room_id FROM room_members WHERE user_id=?', userId))
      affectedRooms.add(member.room_id);
  }
  for (const roomId of affectedRooms) {
    const otherConnection = [...connections].some(
      (connection) =>
        connection.roomId === roomId && connection.user?.id === userId && sessionAlive(connection),
    );
    if (!otherConnection) departRoom(roomId, userId);
  }
  broadcast('online', onlineState());
});
function canViewRoom(req, room) {
  return (
    room.visibility === 'public' ||
    activeMember(room.id, req.user?.id) ||
    (typeof req.query.invite === 'string' &&
      room.invite_hash &&
      hashToken(req.query.invite) === room.invite_hash)
  );
}
function messageShape(message) {
  return {
    id: message.id,
    roomId: message.room_id,
    body: message.body,
    text: message.body,
    author: author(message),
    userId: message.user_id,
    createdAt: message.created_at,
  };
}
function messages(roomId = null) {
  return all(
    'SELECT messages.*,users.name,users.avatar FROM messages JOIN users ON users.id=messages.user_id WHERE room_id IS ? ORDER BY messages.created_at DESC LIMIT 100',
    roomId,
  )
    .reverse()
    .map(messageShape);
}
function bool(value, name) {
  if (typeof value !== 'boolean') throw apiError(400, `${name} must be true or false.`);
  return value;
}
export function safeSourceUrl(value) {
  if (value === '') return '';
  const input = text(value, { name: 'Source URL', min: 1, max: 2048 });
  let url;
  try {
    url = new URL(input);
  } catch {
    throw apiError(400, 'Enter a valid source URL.');
  }
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password)
    throw apiError(400, 'Sources must use an HTTP or HTTPS URL without embedded credentials.');
  const hostname = url.hostname.toLowerCase();
  if (
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname.endsWith('.local') ||
    hostname === '[::1]' ||
    hostname.includes(':') ||
    /^(0|10|127|169\.254|192\.168)\./.test(hostname) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(hostname)
  )
    throw apiError(400, 'Choose a publicly accessible source URL.');
  return url.toString();
}

socialRouter.get(
  '/library',
  requireAuth,
  asyncRoute(async (req, res) => {
    const entries = all(
      'SELECT * FROM library WHERE user_id=? ORDER BY updated_at DESC LIMIT 5000',
      req.user.id,
    );
    const items = await Promise.all(
      entries.map(async (entry) => ({
        mediaId: entry.media_id,
        media: await getMedia(entry.media_id),
        favorite: Boolean(entry.favorite),
        status: entry.status,
        progress: entry.progress,
        score: entry.score,
        updatedAt: entry.updated_at,
      })),
    );
    res.json({ items });
  }),
);
socialRouter.put(
  '/library/:mediaId',
  requireAuth,
  asyncRoute(async (req, res) => {
    const id = mediaId(req.params.mediaId);
    const media = await getMedia(id);
    if (!media) throw apiError(404, 'This title could not be found.');
    // Read mutable user state after metadata loading so parallel partial updates merge.
    const existing = get('SELECT * FROM library WHERE user_id=? AND media_id=?', req.user.id, id);
    const favorite =
      req.body.favorite === undefined
        ? Boolean(existing?.favorite)
        : bool(req.body.favorite, 'Favorite');
    const status = req.body.status ?? existing?.status ?? 'planned';
    if (!STATUS.has(status)) throw apiError(400, 'Choose a valid list status.');
    const progress =
      req.body.progress === undefined
        ? existing?.progress || 0
        : numeric(req.body.progress, { name: 'Progress', max: 100000 });
    const score =
      req.body.score === undefined
        ? (existing?.score ?? null)
        : req.body.score === null
          ? null
          : numeric(req.body.score, { name: 'Score', min: 0, max: 10 });
    const updatedAt = now();
    run(
      'INSERT INTO library(user_id,media_id,favorite,status,progress,score,updated_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(user_id,media_id) DO UPDATE SET favorite=excluded.favorite,status=excluded.status,progress=excluded.progress,score=excluded.score,updated_at=excluded.updated_at',
      req.user.id,
      id,
      Number(favorite),
      status,
      progress,
      score,
      updatedAt,
    );
    broadcast('library', { userId: req.user.id, mediaId: id });
    res.json({ item: { mediaId: id, media, favorite, status, progress, score, updatedAt } });
  }),
);
socialRouter.delete('/library/:mediaId', requireAuth, (req, res) => {
  run('DELETE FROM library WHERE user_id=? AND media_id=?', req.user.id, req.params.mediaId);
  broadcast('library', { userId: req.user.id, mediaId: req.params.mediaId });
  res.json({ ok: true });
});

function reviewShape(review) {
  return {
    id: review.id,
    mediaId: review.media_id,
    userId: review.user_id,
    author: author(review),
    title: review.title,
    body: review.body,
    rating: review.rating,
    spoiler: Boolean(review.spoiler),
    createdAt: review.created_at,
    updatedAt: review.updated_at,
  };
}
socialRouter.get('/reviews/:mediaId', (req, res) => {
  const items = all(
    'SELECT reviews.*,users.name,users.avatar FROM reviews JOIN users ON users.id=reviews.user_id WHERE media_id=? ORDER BY updated_at DESC LIMIT 100',
    req.params.mediaId,
  ).map(reviewShape);
  res.json({ items });
});
socialRouter.post('/reviews/:mediaId', requireAuth, (req, res) => {
  const id = mediaId(req.params.mediaId);
  const body = text(req.body.body, { name: 'Review', min: 10, max: 10000 });
  const title = text(req.body.title || '', { name: 'Title', max: 120 });
  const rating = numeric(req.body.rating, { name: 'Rating', min: 1, max: 10, integer: true });
  const spoiler = req.body.spoiler === undefined ? false : bool(req.body.spoiler, 'Spoiler');
  const existing = get('SELECT id FROM reviews WHERE user_id=? AND media_id=?', req.user.id, id);
  const reviewId = existing?.id || randomUUID();
  const timestamp = now();
  run(
    'INSERT INTO reviews(id,user_id,media_id,rating,title,body,spoiler,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(user_id,media_id) DO UPDATE SET rating=excluded.rating,title=excluded.title,body=excluded.body,spoiler=excluded.spoiler,updated_at=excluded.updated_at',
    reviewId,
    req.user.id,
    id,
    rating,
    title,
    body,
    Number(spoiler),
    timestamp,
    timestamp,
  );
  const review = reviewShape(
    get(
      'SELECT reviews.*,users.name,users.avatar FROM reviews JOIN users ON users.id=reviews.user_id WHERE reviews.id=?',
      reviewId,
    ),
  );
  broadcast('reviews', { mediaId: id });
  res.status(existing ? 200 : 201).json({ review });
});
socialRouter.delete('/reviews/:id', requireAuth, (req, res) => {
  const result = run('DELETE FROM reviews WHERE id=? AND user_id=?', req.params.id, req.user.id);
  if (!result.changes) throw apiError(404, 'Review not found.');
  res.json({ ok: true });
});

function commentShape(comment) {
  return {
    id: comment.id,
    mediaId: comment.media_id,
    unit: comment.unit,
    parentId: comment.parent_id,
    userId: comment.user_id,
    author: author(comment),
    body: comment.body,
    text: comment.body,
    spoiler: Boolean(comment.spoiler),
    score: comment.score || 0,
    votes: comment.score || 0,
    likes: comment.likes || 0,
    dislikes: comment.dislikes || 0,
    viewerVote: comment.viewer_vote || 0,
    createdAt: comment.created_at,
  };
}
const COMMENT_QUERY = `SELECT comments.*,users.name,users.avatar,
  (SELECT COUNT(*) FROM comment_votes WHERE comment_id=comments.id AND value=1) AS likes,
  (SELECT COUNT(*) FROM comment_votes WHERE comment_id=comments.id AND value=-1) AS dislikes,
  COALESCE((SELECT SUM(value) FROM comment_votes WHERE comment_id=comments.id),0) AS score,
  COALESCE((SELECT value FROM comment_votes WHERE comment_id=comments.id AND user_id=?),0) AS viewer_vote
  FROM comments JOIN users ON users.id=comments.user_id`;
socialRouter.get('/comments/:mediaId', (req, res) => {
  const unit = numeric(Number(req.query.unit || 0), { name: 'Episode or chapter', integer: true });
  const items = all(
    `${COMMENT_QUERY} WHERE media_id=? AND unit=? ORDER BY comments.created_at DESC LIMIT 500`,
    req.user?.id || '',
    req.params.mediaId,
    unit,
  ).map(commentShape);
  res.json({ items });
});
socialRouter.post('/comments/:mediaId', requireAuth, (req, res) => {
  const id = mediaId(req.params.mediaId);
  const unit = numeric(Number(req.body.unit ?? req.query.unit ?? 0), {
    name: 'Episode or chapter',
    integer: true,
  });
  const body = text(req.body.body ?? req.body.text, { name: 'Comment', min: 1, max: 5000 });
  const mediaError = commentMediaError(body);
  if (mediaError) throw apiError(400, mediaError);
  const parentId = req.body.parentId || null;
  if (parentId) {
    const parent = get(
      'SELECT * FROM comments WHERE id=? AND media_id=? AND unit=?',
      typeof parentId === 'string' ? parentId : '',
      id,
      unit,
    );
    if (!parent) throw apiError(400, 'Reply to a comment in this discussion.');
    let depth = 1;
    let ancestor = parent;
    while (ancestor.parent_id && depth < 5) {
      ancestor = get('SELECT parent_id FROM comments WHERE id=?', ancestor.parent_id);
      depth++;
    }
    if (depth >= 5) throw apiError(400, 'This reply thread has reached its nesting limit.');
  }
  const spoiler = req.body.spoiler === undefined ? false : bool(req.body.spoiler, 'Spoiler');
  const commentId = randomUUID();
  run(
    'INSERT INTO comments(id,user_id,media_id,unit,parent_id,body,spoiler,created_at) VALUES(?,?,?,?,?,?,?,?)',
    commentId,
    req.user.id,
    id,
    unit,
    parentId,
    body,
    Number(spoiler),
    now(),
  );
  const comment = commentShape(get(`${COMMENT_QUERY} WHERE comments.id=?`, req.user.id, commentId));
  broadcast('comments', { mediaId: id, unit });
  res.status(201).json({ comment });
});
socialRouter.post('/comments/:id/vote', requireAuth, (req, res) => {
  const value = numeric(req.body.value, { name: 'Vote', min: -1, max: 1, integer: true });
  const comment = get('SELECT * FROM comments WHERE id=?', req.params.id);
  if (!comment) throw apiError(404, 'Comment not found.');
  if (value === 0)
    run('DELETE FROM comment_votes WHERE comment_id=? AND user_id=?', comment.id, req.user.id);
  else
    run(
      'INSERT INTO comment_votes(comment_id,user_id,value) VALUES(?,?,?) ON CONFLICT(comment_id,user_id) DO UPDATE SET value=excluded.value',
      comment.id,
      req.user.id,
      value,
    );
  const result = commentShape(get(`${COMMENT_QUERY} WHERE comments.id=?`, req.user.id, comment.id));
  broadcast('comments', { mediaId: comment.media_id, unit: comment.unit });
  res.json({ comment: result });
});
socialRouter.delete('/comments/:id', requireAuth, (req, res) => {
  const comment = get(
    'SELECT * FROM comments WHERE id=? AND user_id=?',
    req.params.id,
    req.user.id,
  );
  if (!comment) throw apiError(404, 'Comment not found.');
  run('DELETE FROM comments WHERE id=?', comment.id);
  broadcast('comments', { mediaId: comment.media_id, unit: comment.unit });
  res.json({ ok: true });
});

socialRouter.get(
  '/community',
  asyncRoute(async (req, res) => {
    const scopedIds =
      req.query.collection === 'ara-ara'
        ? (await getAraCatalog()).items.map((item) => item.id)
        : null;
    const filter = scopedIds
      ? ` WHERE media_id IN (${scopedIds.map(() => '?').join(',') || 'NULL'})`
      : '';
    const bindings = scopedIds || [];
    const comments = all(
      `${COMMENT_QUERY}${filter} ORDER BY comments.created_at DESC LIMIT 20`,
      '',
      ...bindings,
    ).map((row) => ({ ...commentShape(row), kind: 'comment', type: 'comment' }));
    const reviews =
      req.query.type === 'comment'
        ? []
        : all(
            `SELECT reviews.*,users.name,users.avatar FROM reviews JOIN users ON users.id=reviews.user_id${filter} ORDER BY updated_at DESC LIMIT 20`,
            ...bindings,
          ).map((row) => ({ ...reviewShape(row), kind: 'review', type: 'review' }));
    const items = await Promise.all(
      [...comments, ...reviews]
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .slice(0, 24)
        .map(async (item) => ({ ...item, media: await getMedia(item.mediaId) })),
    );
    res.json({ items, online: onlineState() });
  }),
);
socialRouter.get('/online', (_req, res) => res.json(onlineState()));
socialRouter.get('/chat', (_req, res) => res.json({ items: messages() }));
socialRouter.post('/chat', requireAuth, (req, res) => {
  const body = text(req.body.body ?? req.body.text, { name: 'Message', min: 1, max: 2000 });
  const id = randomUUID();
  run(
    'INSERT INTO messages(id,user_id,room_id,body,created_at) VALUES(?,?,NULL,?,?)',
    id,
    req.user.id,
    body,
    now(),
  );
  const message = messageShape(
    get(
      'SELECT messages.*,users.name,users.avatar FROM messages JOIN users ON users.id=messages.user_id WHERE messages.id=?',
      id,
    ),
  );
  broadcast('chat', { message, roomId: null });
  res.status(201).json({ message });
});

socialRouter.get(
  '/rooms',
  asyncRoute(async (req, res) => {
    const rows = all(
      `SELECT DISTINCT rooms.* FROM rooms LEFT JOIN room_members ON rooms.id=room_members.room_id AND room_members.user_id=? AND room_members.last_seen>? WHERE rooms.closed_at IS NULL AND (visibility='public' OR room_members.user_id IS NOT NULL) ORDER BY rooms.created_at DESC LIMIT 60`,
      req.user?.id || '',
      Date.now() - PRESENCE_TTL,
    );
    res.json({ items: await Promise.all(rows.map((room) => enrichedRoom(room, req.user?.id))) });
  }),
);
socialRouter.post(
  '/rooms',
  requireAuth,
  asyncRoute(async (req, res) => {
    const name = text(req.body.name, { name: 'Room name', min: 2, max: 80 });
    const id = randomBytes(12).toString('base64url');
    const titleId = mediaId(req.body.mediaId);
    const type = req.body.type || 'watch';
    const visibility = req.body.visibility || 'public';
    if (!['watch', 'read'].includes(type) || !['public', 'private'].includes(visibility))
      throw apiError(400, 'Choose a valid room type and visibility.');
    const capacity =
      req.body.capacity === undefined
        ? 12
        : numeric(req.body.capacity, { name: 'Capacity', min: 2, max: 20, integer: true });
    if (
      get('SELECT COUNT(*) AS count FROM rooms WHERE host_id=? AND closed_at IS NULL', req.user.id)
        .count >= 5
    )
      throw apiError(400, 'You can host up to five active rooms.');
    const media = await getMedia(titleId);
    if (!media) throw apiError(404, 'Choose an available title.');
    const invite = visibility === 'private' ? randomBytes(24).toString('base64url') : null;
    const unit =
      req.body.unit === undefined
        ? 1
        : numeric(req.body.unit, {
            name: 'Episode or chapter',
            min: type === 'read' ? 0 : 1,
            max: 100000,
            integer: type !== 'read',
          });
    const initialSource =
      req.body.sourceKind === 'reader'
        ? roomReaderPath(req.body.sourceUrl, titleId, unit)
        : req.body.sourceUrl === undefined
          ? ''
          : safeSourceUrl(req.body.sourceUrl);
    if (initialSource === null)
      throw apiError(400, 'Choose a reader link for this title and chapter.');
    const initialKind = req.body.sourceKind ?? 'external';
    if (!['external', 'embed', 'hls', 'video', 'reader'].includes(initialKind))
      throw apiError(400, 'Choose a valid source type.');
    const initialPosition =
      req.body.position === undefined
        ? 0
        : numeric(req.body.position, { name: 'Playback position', max: 604800 });
    const timestamp = now();
    transaction(() => {
      run(
        'INSERT INTO rooms(id,host_id,name,media_id,type,visibility,invite_hash,capacity,unit,source_url,source_kind,position,state_updated_at,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
        id,
        req.user.id,
        name,
        titleId,
        type,
        visibility,
        invite ? hashToken(invite) : null,
        capacity,
        unit,
        initialSource,
        initialKind,
        initialPosition,
        timestamp,
        timestamp,
      );
      run(
        'INSERT INTO room_members(room_id,user_id,joined_at,last_seen) VALUES(?,?,?,?)',
        id,
        req.user.id,
        timestamp,
        Date.now(),
      );
    });
    const room = { ...roomShape(checkedRoom(id), req.user.id), media };
    broadcast('rooms', { changed: true });
    res
      .status(201)
      .json({ room, inviteUrl: `/rooms/${id}${invite ? `?invite=${invite}` : ''}`, invite });
  }),
);
socialRouter.get(
  '/rooms/:id',
  asyncRoute(async (req, res) => {
    const room = checkedRoom(req.params.id);
    if (!canViewRoom(req, room))
      throw apiError(404, 'This room is private. Open its invitation link to join.');
    if (activeMember(room.id, req.user?.id)) touchMember(room.id, req.user.id);
    res.json({ room: await enrichedRoom(room, req.user?.id) });
  }),
);
socialRouter.post(
  '/rooms/:id/join',
  requireAuth,
  asyncRoute(async (req, res) => {
    const room = checkedRoom(req.params.id);
    const existing = activeMember(room.id, req.user.id);
    if (
      room.visibility === 'private' &&
      !existing &&
      (typeof req.body.invite !== 'string' || hashToken(req.body.invite) !== room.invite_hash)
    )
      throw apiError(403, 'A valid invitation is required for this private room.');
    transaction(() => {
      if (!existing && members(room.id).length >= room.capacity)
        throw apiError(409, 'This room is full.');
      run(
        'INSERT INTO room_members(room_id,user_id,joined_at,last_seen) VALUES(?,?,?,?) ON CONFLICT(room_id,user_id) DO UPDATE SET last_seen=excluded.last_seen',
        room.id,
        req.user.id,
        now(),
        Date.now(),
      );
      if (!activeMember(room.id, room.host_id))
        run('UPDATE rooms SET host_id=?,version=version+1 WHERE id=?', req.user.id, room.id);
    });
    notifyRoom(room.id);
    res.json({ room: await enrichedRoom(checkedRoom(room.id), req.user.id) });
  }),
);
socialRouter.post('/rooms/:id/leave', requireAuth, (req, res) => {
  const room = checkedRoom(req.params.id);
  departRoom(room.id, req.user.id);
  for (const connection of connections)
    if (connection.roomId === room.id && connection.user?.id === req.user.id) {
      emit(connection, 'left', { roomId: room.id });
      connection.res.end();
    }
  notifyRoom(room.id);
  res.json({ ok: true });
});
socialRouter.patch('/rooms/:id', requireAuth, (req, res) => {
  const room = checkedRoom(req.params.id);
  requireMember(req, room);
  if (room.host_id !== req.user.id)
    throw apiError(403, 'Only the room host can control the shared session.');
  if (req.body.version !== undefined && req.body.version !== room.version)
    throw apiError(409, 'The room has changed. Refresh its state and try again.');
  const unit =
    req.body.unit === undefined
      ? room.unit
      : numeric(req.body.unit, {
          name: 'Episode or chapter',
          min: room.type === 'read' ? 0 : 1,
          max: 100000,
          integer: room.type !== 'read',
        });
  const paused =
    req.body.paused === undefined ? Boolean(room.paused) : bool(req.body.paused, 'Paused');
  const elapsed = room.paused
    ? 0
    : Math.max(0, (Date.now() - Date.parse(room.state_updated_at)) / 1000);
  const position =
    req.body.position === undefined
      ? unit === room.unit
        ? Math.min(604800, room.position + elapsed)
        : 0
      : numeric(req.body.position, { name: 'Playback position', max: 604800 });
  const sourceKind = req.body.sourceKind ?? room.source_kind;
  const requestedSource =
    req.body.sourceUrl === undefined
      ? sourceKind === 'reader' && unit !== room.unit
        ? readerAtUnit(room.source_url, room.media_id, unit)
        : room.source_url
      : req.body.sourceUrl;
  const sourceUrl =
    sourceKind === 'reader'
      ? roomReaderPath(requestedSource, room.media_id, unit)
      : safeSourceUrl(requestedSource);
  if (sourceUrl === null) throw apiError(400, 'Choose a reader link for this title and chapter.');
  if (!['external', 'embed', 'hls', 'video', 'reader'].includes(sourceKind))
    throw apiError(400, 'Choose a valid source type.');
  run(
    'UPDATE rooms SET unit=?,paused=?,position=?,source_url=?,source_kind=?,version=version+1,state_updated_at=? WHERE id=?',
    unit,
    Number(paused),
    position,
    sourceUrl,
    sourceKind,
    now(),
    room.id,
  );
  notifyRoom(room.id);
  res.json({ room: roomShape(checkedRoom(room.id), req.user.id) });
});
socialRouter.get('/rooms/:id/chat', requireAuth, (req, res) => {
  const room = checkedRoom(req.params.id);
  requireMember(req, room);
  res.json({ items: messages(room.id) });
});
socialRouter.post('/rooms/:id/chat', requireAuth, (req, res) => {
  const room = checkedRoom(req.params.id);
  requireMember(req, room);
  const body = text(req.body.body ?? req.body.text, { name: 'Message', min: 1, max: 2000 });
  const id = randomUUID();
  run(
    'INSERT INTO messages(id,user_id,room_id,body,created_at) VALUES(?,?,?,?,?)',
    id,
    req.user.id,
    room.id,
    body,
    now(),
  );
  const message = messageShape(
    get(
      'SELECT messages.*,users.name,users.avatar FROM messages JOIN users ON users.id=messages.user_id WHERE messages.id=?',
      id,
    ),
  );
  broadcast('chat', { message, roomId: room.id }, room.id);
  res.status(201).json({ message });
});

socialRouter.get('/events', (req, res) => {
  const roomId = typeof req.query.roomId === 'string' ? req.query.roomId : null;
  let room;
  if (roomId) {
    room = checkedRoom(roomId);
    requireMember(req, room);
  }
  if (
    connections.size >= 1000 ||
    [...connections].filter((connection) => connection.ip === req.ip).length >= 60
  )
    throw apiError(429, 'Too many live connections.');
  res.status(200).set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders();
  res.write('retry: 3000\n\n');
  const connection = { res, user: req.user, sessionHash: req.sessionHash, roomId, ip: req.ip };
  connections.add(connection);
  emit(connection, 'snapshot', {
    online: onlineState(),
    ...(room ? { room: roomShape(room, req.user?.id) } : {}),
  });
  broadcast('online', onlineState());
  if (roomId) notifyRoom(roomId);
  const interval = setInterval(() => {
    // Revalidate session so logout/expiration terminates a pre-existing live connection.
    if (!sessionAlive(connection)) return disconnect(connection);
    if (roomId) {
      if (
        !get('SELECT room_id FROM room_members WHERE room_id=? AND user_id=?', roomId, req.user.id)
      )
        return res.end();
      touchMember(roomId, req.user.id);
    }
    res.write(': heartbeat\n\n');
  }, 15000);
  interval.unref();
  connection.interval = interval;
  req.on('close', () => {
    clearInterval(interval);
    connections.delete(connection);
    broadcast('online', onlineState());
  });
});

const cleanup = setInterval(() => {
  const expiredRooms = all(
    'SELECT DISTINCT room_id FROM room_members WHERE last_seen<=?',
    Date.now() - PRESENCE_TTL,
  );
  if (!expiredRooms.length) return;
  run('DELETE FROM room_members WHERE last_seen<=?', Date.now() - PRESENCE_TTL);
  for (const { room_id: id } of expiredRooms) {
    const room = get('SELECT * FROM rooms WHERE id=? AND closed_at IS NULL', id);
    if (!room) continue;
    if (!activeMember(id, room.host_id)) {
      const next = members(id)[0];
      if (next) run('UPDATE rooms SET host_id=?,version=version+1 WHERE id=?', next.id, id);
      else run('UPDATE rooms SET closed_at=? WHERE id=?', now(), id);
    }
    notifyRoom(id);
  }
}, 30000);
cleanup.unref();
export function closeSocial() {
  clearInterval(cleanup);
  for (const connection of connections) connection.res.end();
  connections.clear();
}
