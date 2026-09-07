import { flushSync } from 'react-dom';
import { api } from './api';

const names = [
  'snapshot',
  'presence',
  'online',
  'chat',
  'room',
  'rooms',
  'comments',
  'reviews',
  'library',
  'left',
];
export function connectEvents({ transport = 'sse', roomId, onEvent, onOpen, onError }) {
  if (transport === 'sse') {
    const stream = new EventSource(
      `/api/events${roomId ? `?roomId=${encodeURIComponent(roomId)}` : ''}`,
    );
    for (const name of names) stream.addEventListener(name, onEvent);
    stream.onopen = onOpen;
    stream.onerror = onError;
    return { close: () => stream.close() };
  }
  let active = true,
    timer,
    cursor,
    onlineKey = '',
    roomKey = '',
    snapshot = true;
  const controller = new AbortController(),
    connectionId = crypto.randomUUID();
  const emit = (type, data) => {
    if (active) flushSync(() => onEvent({ type, data: JSON.stringify(data) }));
  };
  async function poll() {
    let delay = 1500;
    try {
      const params = new URLSearchParams({
        connectionId,
        ...(roomId ? { roomId } : {}),
        ...(cursor === undefined ? {} : { cursor: String(cursor) }),
      });
      const data = await api(`/api/poll?${params}`, { signal: controller.signal });
      if (!active) return;
      onOpen?.();
      if (snapshot) {
        emit('snapshot', { online: data.online, ...(roomId ? { room: data.room } : {}) });
        snapshot = false;
      } else {
        if (JSON.stringify(data.online) !== onlineKey) emit('online', data.online);
        if (roomId && JSON.stringify(data.room) !== roomKey)
          emit('room', { roomId, room: data.room });
      }
      onlineKey = JSON.stringify(data.online);
      roomKey = JSON.stringify(data.room);
      for (const event of data.events) emit(event.event, event.data);
      cursor = data.cursor;
      // Drain a busy cursor without waiting for the next regular poll.
      if (data.events.length === 100) delay = 0;
    } catch (error) {
      if (!active) return;
      onError?.();
      snapshot = true;
      delay = 3000;
      if (roomId && [401, 403, 404].includes(error.status)) {
        emit('left', { roomId });
        active = false;
        return;
      }
    }
    if (active) timer = setTimeout(poll, delay);
  }
  poll();
  return {
    close() {
      active = false;
      clearTimeout(timer);
      controller.abort();
    },
  };
}
