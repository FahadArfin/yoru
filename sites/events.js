import { streamSSE } from 'hono/streaming';
import { randomUUID } from 'node:crypto';
import { onlineState } from './social.js';
import { activeMember, checkedRoom, roomShape, reconcileRooms } from './rooms.js';
import { apiError } from '../server/validation.js';
import { socialRequest, socialDatabase } from './native-social.js';
import { liveSocialPolicy } from '../server/native-social-policy.js';
import { readSocialEvents } from '../server/native-social-events.js';

const eventWhere = `(room_id IS NULL OR room_id=?) AND (user_id IS NULL OR user_id=?)
 AND (?='' OR EXISTS(SELECT 1 FROM sessions WHERE token_hash=? AND expires_at>?))
 AND (room_id IS NULL OR EXISTS(SELECT 1 FROM room_members WHERE room_id=event_log.room_id AND user_id=? AND last_seen>?))`;
const eventValues = (roomId, user, sessionHash) => [
  roomId,
  user?.id || '',
  sessionHash,
  sessionHash,
  Date.now(),
  user?.id || '',
  Date.now() - 90000,
];

export function eventRoutes(app) {
  app.get('/api/poll', async (c) => {
    const db = await socialDatabase(c),
      policy = await socialRequest(c),
      user = c.get('user'),
      sessionHash = c.get('sessionHash'),
      roomId = c.req.query('roomId') || null;
    const connectionId = c.req.query('connectionId') || '';
    if (!/^[a-zA-Z0-9-]{1,80}$/.test(connectionId)) throw apiError(400, 'Invalid live connection.');
    let room;
    if (roomId) {
      await reconcileRooms(db);
      room = await checkedRoom(db, roomId);
      await policy.room(room);
      if (!(await activeMember(db, roomId, user?.id)))
        throw apiError(403, 'Join this room to take part.');
    }
    if (user) {
      await db.run(
        `INSERT INTO presence_leases(connection_id,session_hash,user_id,room_id,expires_at)
        SELECT ?,?,?,?,? WHERE EXISTS(SELECT 1 FROM sessions WHERE token_hash=? AND expires_at>?)
        ON CONFLICT(connection_id) DO UPDATE SET expires_at=excluded.expires_at
        WHERE presence_leases.session_hash=excluded.session_hash AND presence_leases.user_id=excluded.user_id AND presence_leases.room_id IS excluded.room_id`,
        connectionId,
        sessionHash,
        user.id,
        roomId,
        Date.now() + 10000,
        sessionHash,
        Date.now(),
      );
      if (roomId)
        await db.run(
          'UPDATE room_members SET last_seen=? WHERE room_id=? AND user_id=?',
          Date.now(),
          roomId,
          user.id,
        );
    }
    const newest = await db.get('SELECT COALESCE(MAX(sequence),0) AS sequence FROM event_log');
    const requested = c.req.query('cursor') === undefined ? null : Number(c.req.query('cursor'));
    const cursor =
      Number.isSafeInteger(requested) && requested >= 0
        ? Math.min(requested, newest.sequence)
        : newest.sequence;
    const page = await readSocialEvents({
      policy,
      db,
      cursor,
      where: eventWhere,
      values: eventValues(roomId, user, sessionHash),
    });
    const shaped = room
        ? await roomShape(db, await checkedRoom(db, roomId), user?.id, false, policy)
        : undefined,
      online = await onlineState(db);
    if (
      roomId &&
      (!shaped?.joined ||
        !(await db.get(
          'SELECT 1 FROM sessions WHERE token_hash=? AND expires_at>?',
          sessionHash,
          Date.now(),
        )))
    )
      throw apiError(403, 'Join this room to take part.');
    await policy.current();
    return c.json({
      viewerId: user?.id || null,
      cursor: page.complete ? Math.max(page.cursor, newest.sequence) : page.cursor,
      events: page.events.map((event) =>
        event.data.room ? { ...event, data: { ...event.data, room: shaped || null } } : event,
      ),
      ...(await policy.status()),
      complete: page.complete && (await policy.status()).complete,
      online,
      ...(roomId ? { room: shaped } : {}),
    });
  });
  app.get('/api/events', async (c) => {
    const db = await socialDatabase(c),
      policy = await socialRequest(c),
      user = c.get('user'),
      sessionHash = c.get('sessionHash'),
      roomId = c.req.query('roomId') || null;
    if (roomId) {
      await reconcileRooms(db);
      await policy.room(await checkedRoom(db, roomId));
      if (!(await activeMember(db, roomId, user?.id)))
        throw apiError(403, 'Join this room to take part.');
    }
    const connectionId = randomUUID();
    if (user) {
      await db.run(
        'INSERT INTO presence_leases(connection_id,session_hash,user_id,room_id,expires_at) SELECT ?,?,?,?,? WHERE EXISTS(SELECT 1 FROM sessions WHERE token_hash=? AND expires_at>?)',
        connectionId,
        sessionHash,
        user.id,
        roomId,
        Date.now() + 25000,
        sessionHash,
        Date.now(),
      );
      if (roomId)
        await db.run(
          'UPDATE room_members SET last_seen=? WHERE room_id=? AND user_id=?',
          Date.now(),
          roomId,
          user.id,
        );
    }
    const newest = await db.get('SELECT COALESCE(MAX(sequence),0) AS sequence FROM event_log');
    const requested = Number(c.req.header('last-event-id'));
    let cursor =
      Number.isSafeInteger(requested) && requested > 0
        ? Math.min(requested, newest.sequence)
        : newest.sequence;
    c.header('Cache-Control', 'no-store, no-transform');
    c.header('X-Accel-Buffering', 'no');
    let initial = policy;
    const live = liveSocialPolicy(async () => {
      if (initial) {
        const value = initial;
        initial = null;
        return value;
      }
      return socialRequest(c, { fresh: true });
    });
    return streamSSE(c, async (stream) => {
      let aborted = false,
        previousOnline = '',
        previousRoom = '';
      stream.onAbort(() => {
        aborted = true;
        c.executionCtx.waitUntil(
          c
            .get('db')
            .run('DELETE FROM presence_leases WHERE connection_id=?', connectionId)
            .catch(() => {}),
        );
      });
      await stream.write('retry: 1000\n\n');
      // Each stream is bounded to keep it below D1's per-request query allowance.
      // Event IDs survive EventSource reconnects; leases and events are shared across isolates.
      for (let tick = 0; tick < 5 && !aborted; tick++) {
        if (tick) await stream.sleep(2000);
        if (aborted) break;
        if (
          user &&
          !(await db.get(
            'SELECT user_id FROM sessions WHERE token_hash=? AND expires_at>?',
            sessionHash,
            Date.now(),
          ))
        ) {
          if (roomId) await stream.writeSSE({ event: 'left', data: JSON.stringify({ roomId }) });
          break;
        }
        let delivery;
        try {
          delivery = await live.delivery();
        } catch {
          if (roomId) await stream.writeSSE({ event: 'left', data: JSON.stringify({ roomId }) });
          break;
        }
        let shaped;
        if (roomId) {
          const room = await db.get('SELECT * FROM rooms WHERE id=? AND closed_at IS NULL', roomId);
          try {
            shaped = room ? await roomShape(db, room, user?.id, false, delivery) : null;
          } catch {
            break;
          }
          if (!shaped?.joined) {
            await stream.writeSSE({ event: 'left', data: JSON.stringify({ roomId }) });
            break;
          }
        }
        const online = await onlineState(db),
          onlineKey = JSON.stringify(online),
          roomKey = JSON.stringify(shaped);
        if (!tick)
          await stream.writeSSE({
            event: 'snapshot',
            data: JSON.stringify({ online, ...(roomId ? { room: shaped } : {}) }),
          });
        else {
          if (onlineKey !== previousOnline)
            await stream.writeSSE({ event: 'online', data: onlineKey });
          if (roomId && roomKey !== previousRoom)
            await stream.writeSSE({
              event: 'room',
              data: JSON.stringify({ roomId, room: shaped }),
            });
        }
        previousOnline = onlineKey;
        previousRoom = roomKey;
        let page;
        try {
          page = await readSocialEvents({
            policy: delivery,
            db,
            cursor,
            where: eventWhere,
            values: eventValues(roomId, user, sessionHash),
            deadlineAt: Date.now() + 12000,
          });
        } catch {
          break;
        }
        for (const event of page.events) {
          await delivery.current();
          if (roomId) await delivery.room(await checkedRoom(db, roomId));
          await stream.writeSSE({
            id: String(event.id),
            event: event.event,
            data: JSON.stringify(
              event.data.room ? { ...event.data, room: shaped || null } : event.data,
            ),
          });
        }
        cursor = page.cursor;
        await stream.write(': heartbeat\n\n');
      }
    });
  });
}
