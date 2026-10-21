// One small queue for displayed/nearby reader pages. Backoff never holds a slot.
const queue = [];
let active = 0;
function drain() {
  while (active < 4 && queue.length) queue.shift()();
}
function scheduled(operation, signal) {
  return new Promise((resolve, reject) => {
    const abort = () => {
      const index = queue.indexOf(start);
      if (index >= 0) queue.splice(index, 1);
      reject(signal.reason);
    };
    const start = () => {
      signal.removeEventListener('abort', abort);
      if (signal.aborted) return reject(signal.reason);
      active++;
      Promise.resolve()
        .then(operation)
        .then(resolve, reject)
        .finally(() => {
          active--;
          drain();
        });
    };
    if (signal.aborted) return reject(signal.reason);
    signal.addEventListener('abort', abort, { once: true });
    queue.push(start);
    drain();
  });
}
function delay(ms, signal) {
  return new Promise((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', abort);
      resolve();
    }, ms);
    if (signal.aborted) return abort();
    signal.addEventListener('abort', abort, { once: true });
  });
}

export async function loadReaderPage(url, signal) {
  for (let attempt = 0; ; attempt++) {
    let retryAfter = 0;
    try {
      return await scheduled(async () => {
        const response = await fetch(url, {
          signal: AbortSignal.any([signal, AbortSignal.timeout(35000)]),
          cache: 'no-store',
          referrerPolicy: 'no-referrer',
        });
        if (!response.ok) {
          const value = response.headers.get('retry-after');
          retryAfter = /^\d+$/.test(value || '')
            ? Number(value) * 1000
            : Math.max(0, Date.parse(value) - Date.now()) || 0;
          await response.body?.cancel();
          const error = new Error('Page request failed.');
          error.permanent = ![408, 429, 500, 502, 503, 504].includes(response.status);
          throw error;
        }
        const blob = await response.blob();
        if (!blob.type.startsWith('image/') || !blob.size)
          throw new Error('The source did not return an image.');
        return blob;
      }, signal);
    } catch (error) {
      if (signal.aborted || error.permanent || attempt >= 3) throw error;
      await delay(Math.min(30000, Math.max(retryAfter, [800, 2500, 5500][attempt])), signal);
    }
  }
}
