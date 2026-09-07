import { streamSSE } from 'hono/streaming';
import { randomUUID } from 'node:crypto';
import { onlineState } from './social.js';
import { activeMember, checkedRoom, roomShape, reconcileRooms } from './rooms.js';
import { apiError } from '../server/validation.js';

export function eventRoutes(app) {
  app.get('/api/events', async (c) => {
    const db = c.get('db'),
      user = c.get('user'),
      sessionHash = c.get('sessionHash'),
      roomId = c.req.query('roomId') || null;
    if (roomId) {
      await reconcileRooms(db);
      await checkedRoom(db, roomId);
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
    return streamSSE(c, async (stream) => {
      let aborted = false,
        previousOnline = '',
        previousRoom = '';
      stream.onAbort(() => {
        aborted = true;
        c.executionCtx.waitUntil(
          db.run('DELETE FROM presence_leases WHERE connection_id=?', connectionId).catch(() => {}),
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
        let shaped;
        if (roomId) {
          const room = await db.get('SELECT * FROM rooms WHERE id=? AND closed_at IS NULL', roomId);
          shaped = room ? await roomShape(db, room, user?.id) : null;
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
        const events = await db.all(
          `SELECT * FROM event_log WHERE sequence>? AND (room_id IS NULL OR room_id=?) AND (user_id IS NULL OR user_id=?)
          AND (?='' OR EXISTS(SELECT 1 FROM sessions WHERE token_hash=? AND expires_at>?))
          AND (room_id IS NULL OR EXISTS(SELECT 1 FROM room_members WHERE room_id=event_log.room_id AND user_id=? AND last_seen>?))
          ORDER BY sequence LIMIT 100`,
          cursor,
          roomId,
          user?.id || '',
          sessionHash,
          sessionHash,
          Date.now(),
          user?.id || '',
          Date.now() - 90000,
        );
        for (const event of events) {
          cursor = event.sequence;
          await stream.writeSSE({ id: String(cursor), event: event.event, data: event.payload });
        }
        await stream.write(': heartbeat\n\n');
      }
    });
  });
}
