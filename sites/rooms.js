import { roomReaderPath, readerAtUnit } from '../shared/room-reader.js';
import { randomBytes, randomUUID } from 'node:crypto';
import { getMedia } from '../server/catalog-core.js';
import { apiError, text, numeric, mediaId, bool } from '../server/validation.js';
import { requireAuth, hashToken, publicUser } from './security.js';
import { now, eventStatement, changes, liveSession, sessionValues } from './store.js';
import { messages } from './social.js';

export const PRESENCE_TTL = 90000;
const ACTIVE = `last_seen>? AND EXISTS(SELECT 1 FROM sessions WHERE sessions.user_id=room_members.user_id AND expires_at>?)`;
const activeValues = () => [Date.now() - PRESENCE_TTL, Date.now()];
export async function activeMember(db, roomId, userId) {
  return userId
    ? db.get(
        `SELECT * FROM room_members WHERE room_id=? AND user_id=? AND ${ACTIVE}`,
        roomId,
        userId,
        ...activeValues(),
      )
    : null;
}
export async function checkedRoom(db, id) {
  const room = await db.get('SELECT * FROM rooms WHERE id=? AND closed_at IS NULL', id);
  if (!room) throw apiError(404, 'This room is no longer available.');
  return room;
}
export async function reconcileRooms(db) {
  // Expiry is enforced in every access predicate, even if no cleanup invocation ran.
  await db.batch([
    db.statement(
      'DELETE FROM room_members WHERE last_seen<=? OR NOT EXISTS(SELECT 1 FROM sessions WHERE sessions.user_id=room_members.user_id AND expires_at>?)',
      ...activeValues(),
    ),
    db.statement(
      `UPDATE rooms SET host_id=COALESCE((SELECT user_id FROM room_members WHERE room_id=rooms.id ORDER BY joined_at,user_id LIMIT 1),host_id),
      closed_at=CASE WHEN NOT EXISTS(SELECT 1 FROM room_members WHERE room_id=rooms.id) THEN ? ELSE NULL END,
      version=version+1 WHERE closed_at IS NULL AND NOT EXISTS(SELECT 1 FROM room_members WHERE room_id=rooms.id AND user_id=rooms.host_id)`,
      now(),
    ),
  ]);
}
export async function roomShape(db, room, viewerId, withMedia = false) {
  const members = (
    await db.all(
      `SELECT users.id,users.name,users.avatar,room_members.joined_at FROM room_members JOIN users ON users.id=room_members.user_id WHERE room_id=? AND ${ACTIVE} ORDER BY joined_at,user_id`,
      room.id,
      ...activeValues(),
    )
  ).map((x) => ({ id: x.id, name: x.name, avatar: x.avatar || '', joinedAt: x.joined_at }));
  const joined = members.some((x) => x.id === viewerId);
  return {
    id: room.id,
    name: room.name,
    mediaId: room.media_id,
    type: room.type,
    visibility: room.visibility,
    hostId: room.host_id,
    host: publicUser(
      await db.get('SELECT id,name,avatar,created_at FROM users WHERE id=?', room.host_id),
    ),
    capacity: room.capacity,
    members,
    memberCount: members.length,
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
    ...(withMedia ? { media: await getMedia(room.media_id) } : {}),
  };
}
function sourceUrl(value) {
  if (value === '') return '';
  let url;
  try {
    url = new URL(text(value, { name: 'Source URL', min: 1, max: 2048 }));
  } catch {
    throw apiError(400, 'Enter a valid source URL.');
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password)
    throw apiError(400, 'Sources must use an HTTP or HTTPS URL without embedded credentials.');
  const hostname = url.hostname.toLowerCase();
  if (
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname.endsWith('.local') ||
    hostname.includes(':') ||
    /^(0|10|127|169\.254|192\.168)\./.test(hostname) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(hostname)
  )
    throw apiError(400, 'Choose a publicly accessible source URL.');
  return url.toString();
}
export async function requireMember(c, id) {
  if (!(await activeMember(c.get('db'), id, c.get('user')?.id)))
    throw apiError(403, 'Join this room to take part.');
}
export function roomRoutes(app) {
  app.get('/api/rooms', async (c) => {
    const db = c.get('db');
    await reconcileRooms(db);
    const rows = await db.all(
      `SELECT rooms.* FROM rooms WHERE closed_at IS NULL AND (visibility='public' OR EXISTS(SELECT 1 FROM room_members WHERE room_id=rooms.id AND user_id=? AND ${ACTIVE})) ORDER BY created_at DESC LIMIT 20`,
      c.get('user')?.id || '',
      ...activeValues(),
    );
    return c.json({
      items: await Promise.all(rows.map((x) => roomShape(db, x, c.get('user')?.id, true))),
    });
  });
  app.post('/api/rooms', requireAuth, async (c) => {
    const input = await c.req.json(),
      db = c.get('db'),
      userId = c.get('user').id;
    const name = text(input.name, { name: 'Room name', min: 2, max: 80 }),
      id = randomBytes(12).toString('base64url'),
      titleId = mediaId(input.mediaId);
    const type = input.type || 'watch',
      visibility = input.visibility || 'public';
    if (!['watch', 'read'].includes(type) || !['public', 'private'].includes(visibility))
      throw apiError(400, 'Choose a valid room type and visibility.');
    const capacity =
      input.capacity === undefined
        ? 12
        : numeric(input.capacity, { name: 'Capacity', min: 2, max: 20, integer: true });
    const unit =
      input.unit === undefined
        ? 1
        : numeric(input.unit, {
            name: 'Episode or chapter',
            min: type === 'read' ? 0 : 1,
            max: 100000,
            integer: type !== 'read',
          });
    const media = await getMedia(titleId);
    if (!media) throw apiError(404, 'Choose an available title.');
    const initialSource =
      input.sourceKind === 'reader'
        ? roomReaderPath(input.sourceUrl, titleId, unit)
        : input.sourceUrl === undefined
          ? ''
          : sourceUrl(input.sourceUrl);
    if (initialSource === null)
      throw apiError(400, 'Choose a reader link for this title and chapter.');
    const initialKind = input.sourceKind ?? 'external';
    if (!['external', 'embed', 'hls', 'video', 'reader'].includes(initialKind))
      throw apiError(400, 'Choose a valid source type.');
    const initialPosition =
      input.position === undefined
        ? 0
        : numeric(input.position, { name: 'Playback position', max: 604800 });
    const invite = visibility === 'private' ? randomBytes(24).toString('base64url') : null;
    await reconcileRooms(db);
    const result = await db.batch([
      db.statement(
        `INSERT INTO rooms(id,host_id,name,media_id,type,visibility,invite_hash,capacity,unit,source_url,source_kind,position,state_updated_at,created_at)
        SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?,? WHERE (SELECT COUNT(*) FROM rooms WHERE host_id=? AND closed_at IS NULL)<5 AND ${liveSession}`,
        id,
        userId,
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
        now(),
        now(),
        userId,
        ...sessionValues(c),
      ),
      db.statement(
        'INSERT INTO room_members(room_id,user_id,joined_at,last_seen) SELECT id,host_id,?,? FROM rooms WHERE id=?',
        now(),
        Date.now(),
        id,
      ),
      eventStatement(db, 'rooms', { changed: true }),
    ]);
    if (!changes(result[0]))
      throw apiError(
        409,
        'You can host up to five active rooms. Sign in again if your session changed.',
      );
    return c.json(
      {
        room: { ...(await roomShape(db, await checkedRoom(db, id), userId)), media },
        inviteUrl: `/rooms/${id}${invite ? `?invite=${invite}` : ''}`,
        invite,
      },
      201,
    );
  });
  app.get('/api/rooms/:id', async (c) => {
    const db = c.get('db');
    await reconcileRooms(db);
    const room = await checkedRoom(db, c.req.param('id')),
      member = await activeMember(db, room.id, c.get('user')?.id);
    if (
      room.visibility !== 'public' &&
      !member &&
      (!c.req.query('invite') || hashToken(c.req.query('invite')) !== room.invite_hash)
    )
      throw apiError(404, 'This room is private. Open its invitation link to join.');
    if (member)
      await db.run(
        `UPDATE room_members SET last_seen=? WHERE room_id=? AND user_id=? AND ${liveSession}`,
        Date.now(),
        room.id,
        c.get('user').id,
        ...sessionValues(c),
      );
    return c.json({ room: await roomShape(db, room, c.get('user')?.id, true) });
  });
  app.post('/api/rooms/:id/join', requireAuth, async (c) => {
    const db = c.get('db'),
      input = await c.req.json(),
      userId = c.get('user').id;
    await reconcileRooms(db);
    const room = await checkedRoom(db, c.req.param('id'));
    const existing = await activeMember(db, room.id, userId);
    if (
      room.visibility === 'private' &&
      !existing &&
      (typeof input.invite !== 'string' || hashToken(input.invite) !== room.invite_hash)
    )
      throw apiError(403, 'A valid invitation is required for this private room.');
    const result = await db.batch([
      db.statement(
        `INSERT INTO room_members(room_id,user_id,joined_at,last_seen)
        SELECT id,?,?,? FROM rooms WHERE id=? AND closed_at IS NULL AND ${liveSession}
        AND (visibility='public' OR invite_hash=? OR EXISTS(SELECT 1 FROM room_members WHERE room_id=rooms.id AND user_id=? AND ${ACTIVE}))
        AND (EXISTS(SELECT 1 FROM room_members WHERE room_id=rooms.id AND user_id=? AND ${ACTIVE}) OR (SELECT COUNT(*) FROM room_members WHERE room_id=rooms.id AND ${ACTIVE})<capacity)
        ON CONFLICT(room_id,user_id) DO UPDATE SET last_seen=excluded.last_seen`,
        userId,
        now(),
        Date.now(),
        room.id,
        ...sessionValues(c),
        typeof input.invite === 'string' ? hashToken(input.invite) : '',
        userId,
        ...activeValues(),
        userId,
        ...activeValues(),
        ...activeValues(),
      ),
      eventStatement(db, 'rooms', { changed: true }),
    ]);
    if (!changes(result[0]))
      throw apiError(409, 'This room is full or your invitation/session expired.');
    return c.json({ room: await roomShape(db, await checkedRoom(db, room.id), userId, true) });
  });
  app.post('/api/rooms/:id/leave', requireAuth, async (c) => {
    const db = c.get('db'),
      room = await checkedRoom(db, c.req.param('id')),
      userId = c.get('user').id;
    await db.batch([
      db.statement('DELETE FROM room_members WHERE room_id=? AND user_id=?', room.id, userId),
      db.statement('DELETE FROM presence_leases WHERE room_id=? AND user_id=?', room.id, userId),
      db.statement(
        `UPDATE rooms SET host_id=COALESCE((SELECT user_id FROM room_members WHERE room_id=rooms.id AND ${ACTIVE} ORDER BY joined_at,user_id LIMIT 1),host_id),
        closed_at=CASE WHEN NOT EXISTS(SELECT 1 FROM room_members WHERE room_id=rooms.id AND ${ACTIVE}) THEN ? ELSE NULL END,version=version+1 WHERE id=? AND host_id=?`,
        ...activeValues(),
        ...activeValues(),
        now(),
        room.id,
        userId,
      ),
      eventStatement(db, 'rooms', { changed: true }),
    ]);
    return c.json({ ok: true });
  });
  app.patch('/api/rooms/:id', requireAuth, async (c) => {
    const db = c.get('db'),
      input = await c.req.json(),
      room = await checkedRoom(db, c.req.param('id')),
      userId = c.get('user').id;
    await requireMember(c, room.id);
    if (room.host_id !== userId)
      throw apiError(403, 'Only the room host can control the shared session.');
    if (input.version !== undefined && input.version !== room.version)
      throw apiError(409, 'The room has changed. Refresh its state and try again.');
    const unit =
      input.unit === undefined
        ? room.unit
        : numeric(input.unit, {
            name: 'Episode or chapter',
            min: room.type === 'read' ? 0 : 1,
            max: 100000,
            integer: room.type !== 'read',
          });
    const paused = input.paused === undefined ? Boolean(room.paused) : bool(input.paused, 'Paused');
    const elapsed = room.paused
      ? 0
      : Math.max(0, (Date.now() - Date.parse(room.state_updated_at)) / 1000);
    const position =
      input.position === undefined
        ? unit === room.unit
          ? Math.min(604800, room.position + elapsed)
          : 0
        : numeric(input.position, { name: 'Playback position', max: 604800 });
    const kind = input.sourceKind ?? room.source_kind;
    const requestedSource =
      input.sourceUrl === undefined
        ? kind === 'reader' && unit !== room.unit
          ? readerAtUnit(room.source_url, room.media_id, unit)
          : room.source_url
        : input.sourceUrl;
    const source =
      kind === 'reader'
        ? roomReaderPath(requestedSource, room.media_id, unit)
        : sourceUrl(requestedSource);
    if (source === null) throw apiError(400, 'Choose a reader link for this title and chapter.');
    if (!['external', 'embed', 'hls', 'video', 'reader'].includes(kind))
      throw apiError(400, 'Choose a valid source type.');
    const result = await db.batch([
      db.statement(
        `UPDATE rooms SET unit=?,paused=?,position=?,source_url=?,source_kind=?,version=version+1,state_updated_at=? WHERE id=? AND host_id=? AND version=? AND closed_at IS NULL
        AND ${liveSession} AND EXISTS(SELECT 1 FROM room_members WHERE room_id=rooms.id AND user_id=? AND ${ACTIVE})`,
        unit,
        Number(paused),
        position,
        source,
        kind,
        now(),
        room.id,
        userId,
        room.version,
        ...sessionValues(c),
        userId,
        ...activeValues(),
      ),
      eventStatement(db, 'rooms', { changed: true }),
    ]);
    if (!changes(result[0]))
      throw apiError(409, 'The room or your session changed. Refresh and try again.');
    return c.json({ room: await roomShape(db, await checkedRoom(db, room.id), userId) });
  });
  app.get('/api/rooms/:id/chat', requireAuth, async (c) => {
    const room = await checkedRoom(c.get('db'), c.req.param('id'));
    await requireMember(c, room.id);
    return c.json({ items: await messages(c.get('db'), room.id) });
  });
  app.post('/api/rooms/:id/chat', requireAuth, async (c) => {
    const db = c.get('db'),
      input = await c.req.json(),
      user = c.get('user'),
      room = await checkedRoom(db, c.req.param('id'));
    await requireMember(c, room.id);
    const body = text(input.body ?? input.text, { name: 'Message', min: 1, max: 2000 }),
      id = randomUUID(),
      timestamp = now();
    const message = {
      id,
      roomId: room.id,
      body,
      text: body,
      author: publicUser(user),
      userId: user.id,
      createdAt: timestamp,
    };
    const result = await db.batch([
      db.statement(
        `INSERT INTO messages(id,user_id,room_id,body,created_at) SELECT ?,?,?,?,? WHERE ${liveSession}
        AND EXISTS(SELECT 1 FROM room_members JOIN rooms ON rooms.id=room_members.room_id WHERE room_id=? AND user_id=? AND closed_at IS NULL AND ${ACTIVE})`,
        id,
        user.id,
        room.id,
        body,
        timestamp,
        ...sessionValues(c),
        room.id,
        user.id,
        ...activeValues(),
      ),
      db.statement(
        'INSERT INTO event_log(event,payload,room_id,created_at) SELECT ?,?,?,? WHERE EXISTS(SELECT 1 FROM messages WHERE id=?)',
        'chat',
        JSON.stringify({ message, roomId: room.id }),
        room.id,
        Date.now(),
        id,
      ),
    ]);
    if (!changes(result[0])) throw apiError(403, 'Join this room to take part.');
    return c.json({ message }, 201);
  });
}
