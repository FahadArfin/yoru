import { flushSync } from 'react-dom';
import { api } from './api.js';
import { readerContextPath, requireReaderContext } from './reader/requests.js';

const names = [
  'snapshot',
  'presence',
  'online',
  'chat',
  'room',
  'rooms',
  'comments',
  'forum',
  'reviews',
  'library',
  'left',
];
export function connectEvents({
  transport = 'sse',
  roomId,
  context,
  onEvent,
  onOpen,
  onError,
  onSession,
}) {
  if (roomId) {
    try {
      requireReaderContext(context);
    } catch {
      return { close() {} };
    }
  }
  const roomPath = (path) => (roomId ? readerContextPath(path, context) : path);
  if (transport === 'sse') {
    const stream = new EventSource(
      roomPath(`/api/events${roomId ? `?roomId=${encodeURIComponent(roomId)}` : ''}`),
    );
    let closed = false;
    const close = () => {
      closed = true;
      clearTimeout(expiry);
      stream.close();
      context?.signal?.removeEventListener('abort', close);
    };
    const expiry =
      roomId && Number.isFinite(context.expiresAt)
        ? setTimeout(close, Math.max(0, context.expiresAt - Date.now()))
        : null;
    context?.signal?.addEventListener('abort', close, { once: true });
    for (const name of names)
      stream.addEventListener(name, (event) => {
        if (closed) return;
        if (roomId) {
          try {
            requireReaderContext(context);
          } catch {
            close();
            return;
          }
        }
        flushSync(() => onEvent(event));
      });
    stream.onopen = () => {
      if (!closed) onOpen?.();
    };
    stream.onerror = () => {
      if (!closed) onError?.();
    };
    return { close };
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
    if (roomId) {
      try {
        requireReaderContext(context);
      } catch {
        close();
        return;
      }
    }
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
      const data = await api(roomPath(`/api/poll?${params}`), { signal: controller.signal });
      if (!active) return;
      await onSession?.(data.viewerId);
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
  function close() {
    active = false;
    clearTimeout(timer);
    clearTimeout(expiry);
    controller.abort();
    context?.signal?.removeEventListener('abort', close);
  }
  const expiry =
    roomId && Number.isFinite(context.expiresAt)
      ? setTimeout(close, Math.max(0, context.expiresAt - Date.now()))
      : null;
  context?.signal?.addEventListener('abort', close, { once: true });
  poll();
  return { close };
}
