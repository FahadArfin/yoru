import { normalizeServerUrl } from '../../shared/reader-connection.js';
import { operations, bridgeError } from './suwayomi-operations.mjs';

const cancelled = () => new DOMException('Cancelled', 'AbortError');
const expired = () => new DOMException('Operation deadline exceeded', 'TimeoutError');
export class OperationQueue {
  constructor({ pendingCap = 32, now = Date.now } = {}) {
    this.pendingCap = Math.min(32, Math.max(0, pendingCap));
    this.now = now;
    this.pending = [];
    this.active = 0;
  }
  snapshot() {
    return { active: this.active, pending: this.pending.length, pendingCap: this.pendingCap };
  }
  run(task, context = {}) {
    if (context.signal?.aborted) return Promise.reject(cancelled());
    if (context.deadlineAt != null && context.deadlineAt <= this.now())
      return Promise.reject(expired());
    if (this.active && this.pending.length >= this.pendingCap)
      return Promise.reject(
        bridgeError(429, 'The reader is busy. Try again shortly.', {
          retryAfter: '5',
          retryAt: new Date(this.now() + 5000).toISOString(),
        }),
      );
    return new Promise((resolve, reject) => {
      const item = { task, context, resolve, reject };
      const remove = (reason) => {
        const index = this.pending.indexOf(item);
        if (index < 0) return;
        this.pending.splice(index, 1);
        item.cleanup();
        reject(reason);
      };
      const abort = () => remove(cancelled());
      let timer;
      item.cleanup = () => {
        context.signal?.removeEventListener('abort', abort);
        clearTimeout(timer);
      };
      context.signal?.addEventListener('abort', abort, { once: true });
      if (context.deadlineAt != null)
        timer = setTimeout(() => remove(expired()), Math.max(1, context.deadlineAt - this.now()));
      this.pending.push(item);
      this.drain();
    });
  }
  drain() {
    if (this.active || !this.pending.length) return;
    const item = this.pending.shift();
    item.cleanup();
    if (item.context.signal?.aborted) {
      item.reject(cancelled());
      this.drain();
      return;
    }
    if (item.context.deadlineAt != null && item.context.deadlineAt <= this.now()) {
      item.reject(expired());
      this.drain();
      return;
    }
    this.active = 1;
    Promise.resolve()
      .then(() => item.task(item.context))
      .then(
        (value) => {
          this.active = 0;
          item.resolve(value);
          this.drain();
        },
        (reason) => {
          this.active = 0;
          item.reject(reason);
          this.drain();
        },
      );
  }
}
export async function readBounded(response, max) {
  if (!response.body || Number(response.headers.get('content-length')) > max)
    throw bridgeError(502, 'The source response is too large or empty.');
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > max) throw bridgeError(502, 'The source response is too large.');
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  const result = new Uint8Array(size);
  let offset = 0;
  for (const value of chunks) {
    result.set(value, offset);
    offset += value.byteLength;
  }
  return result;
}
export function upstreamFailure(response, now = Date.now()) {
  const raw = response.headers.get('retry-after');
  const retryAfter = raw && raw.length <= 100 && !/[\r\n]/.test(raw) ? raw : null;
  const at =
    retryAfter == null
      ? NaN
      : /^\d+$/.test(retryAfter)
        ? now + Number(retryAfter) * 1000
        : Date.parse(retryAfter);
  return bridgeError(
    response.status,
    response.status === 401 || response.status === 403
      ? 'This server requires sign-in. Check your server credentials.'
      : response.status === 429
        ? 'The source is rate limited. Try again shortly.'
        : 'The reading source is unavailable.',
    {
      retryAfter,
      retryAt: Number.isFinite(at) && Math.abs(at) <= 8.64e15 ? new Date(at).toISOString() : null,
    },
  );
}
export function createSuwayomiClient({
  url,
  authorization,
  fetchImpl = fetch,
  now = Date.now,
  limits = {},
} = {}) {
  const base = normalizeServerUrl(url || 'http://suwayomi:4567');
  const queue = new OperationQueue({ pendingCap: limits.pendingCap ?? 32, now });
  async function request(path, options, context = {}, max = limits.responseBytes || 4 * 1024 ** 2) {
    return queue.run(async () => {
      const remaining =
        context.deadlineAt == null ? 25000 : Math.min(25000, context.deadlineAt - now());
      if (remaining <= 0) throw expired();
      const timeout = AbortSignal.timeout(Math.max(1, Math.ceil(remaining)));
      const signal = context.signal ? AbortSignal.any([context.signal, timeout]) : timeout;
      let response;
      try {
        response = await fetchImpl(`${base}${path}`, {
          ...options,
          redirect: 'error',
          signal,
          headers: { ...options.headers, ...(authorization ? { authorization } : {}) },
        });
        if (!response.ok) throw upstreamFailure(response, now());
        return { response, body: await readBounded(response, max) };
      } catch (e) {
        if (context.signal?.aborted) throw cancelled();
        if (timeout.aborted) throw expired();
        if (e.status) throw e;
        throw bridgeError(503, 'The reading source is temporarily unavailable.');
      }
    }, context);
  }
  return {
    queue,
    async execute(operation, variables = {}, context = {}) {
      if (!Object.hasOwn(operations, operation))
        throw bridgeError(400, 'Unknown reader operation.');
      const { body } = await request(
        '/api/graphql',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ query: operations[operation], variables }),
        },
        context,
      );
      let result;
      try {
        result = JSON.parse(new TextDecoder().decode(body));
      } catch {
        throw bridgeError(502, 'The source returned an incompatible response.');
      }
      if (result.errors?.length) {
        const legacy = result.errors.every((e) =>
          /Cannot query field "contentWarning"/.test(e.message || ''),
        );
        throw bridgeError(503, 'This server does not support this catalog request.', { legacy });
      }
      if (!result.data || typeof result.data !== 'object')
        throw bridgeError(502, 'The source returned an incompatible response.');
      return result.data;
    },
    async fetchImage(path, context = {}) {
      // The adapter must additionally prove exact title/chapter ownership.
      if (
        typeof path !== 'string' ||
        !path.startsWith('/') ||
        path.startsWith('//') ||
        /[\\\x00-\x20#?]/.test(path) ||
        path.length > 2048 ||
        new URL(path, base).pathname !== path
      )
        throw bridgeError(400, 'Invalid source image path.');
      const { response, body } = await request(
        path,
        { method: 'GET' },
        context,
        limits.imageBytes || 20 * 1024 ** 2,
      );
      const type = response.headers.get('content-type')?.split(';')[0];
      if (!['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif'].includes(type))
        throw bridgeError(502, 'The source did not return an image.');
      return { body, type, cached: false };
    },
  };
}
