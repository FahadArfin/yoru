import { readerUpstreamError } from './reader-errors.js';

// Enforce the public deadline even when a test adapter or future transport ignores
// cancellation. Timed-out work never receives a continuation advancement callback.
export async function withinReaderDeadline(context, callback, now = Date.now) {
  const controller = new AbortController();
  let timer, abort;
  const failure = () => readerUpstreamError(504);
  try {
    const timeout = new Promise((_, reject) => {
      abort = () => {
        controller.abort();
        reject(failure());
      };
      if (context.signal?.aborted) return abort();
      context.signal?.addEventListener('abort', abort, { once: true });
      timer = setTimeout(abort, Math.max(0, Math.min(12000, context.deadlineAt - now())));
    });
    return await Promise.race([timeout, callback({ ...context, signal: controller.signal })]);
  } finally {
    clearTimeout(timer);
    context.signal?.removeEventListener('abort', abort);
  }
}
