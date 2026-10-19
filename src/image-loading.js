import { assertMediaEligible } from '../shared/reading-eligibility.js';
const warmed = new Map();
const waiting = new Map();
const queue = [];
let active = 0;

export function canPreload() {
  const connection = globalThis.navigator?.connection;
  return (
    !globalThis.document?.hidden &&
    !connection?.saveData &&
    !/^(slow-)?2g$/.test(connection?.effectiveType || '')
  );
}

function drain() {
  while (active < 2 && queue.length) {
    const job = queue.shift();
    if (job.signal?.aborted || !canPreload()) {
      waiting.delete(job.url);
      job.resolve(false);
      continue;
    }
    active++;
    const image = new Image();
    image.referrerPolicy = 'no-referrer';
    image.fetchPriority = 'low';
    let finished = false;
    const finish = (success) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      job.signal?.removeEventListener('abort', abort);
      image.onload = image.onerror = null;
      if (success) {
        warmed.delete(job.url);
        warmed.set(job.url, Date.now());
        while (warmed.size > 100) warmed.delete(warmed.keys().next().value);
      } else image.src = '';
      waiting.delete(job.url);
      active--;
      job.resolve(success);
      drain();
    };
    const abort = () => finish(false);
    const timer = setTimeout(abort, 15000);
    job.signal?.addEventListener('abort', abort, { once: true });
    image.onload = () => finish(true);
    image.onerror = abort;
    image.src = job.url;
  }
}

export function warmImage(url, signal) {
  if (!url || !canPreload() || signal?.aborted) return Promise.resolve(false);
  if (Date.now() - (warmed.get(url) || 0) < 240000) return Promise.resolve(true);
  if (waiting.has(url)) return waiting.get(url);
  if (queue.length >= 16) return Promise.resolve(false);
  const promise = new Promise((resolve) => queue.push({ url, signal, resolve }));
  waiting.set(url, promise);
  drain();
  return promise;
}

export function coverCandidates(media, context) {
  if (/^ext-manga-[a-f0-9]{32}$/.test(media?.id)) {
    if (!context?.selectionFingerprint || (context.expiresAt && context.expiresAt <= Date.now()))
      return [];
    try {
      assertMediaEligible(media, { ...context, extensionsEnabled: true });
    } catch {
      return [];
    }
    return [
      `/api/media/${media.id}/cover?${new URLSearchParams({ destination: context.destination, selectionFingerprint: context.selectionFingerprint })}`,
    ];
  }
  const primary = media?.cover || media?.coverImage?.extraLarge || media?.coverImage?.large;
  const supplied = [
    primary,
    ...(media?.coverAlternates || []),
    media?.coverImage?.extraLarge,
    media?.coverImage?.large,
  ].filter(Boolean);
  // MAL serves the same artwork in both formats; older cached metadata has only one of them.
  const formats = supplied.flatMap((src) =>
    /^https:\/\/cdn\.myanimelist\.net\/images\/(manga|anime)\/\d+\/\d+l?\.webp$/.test(src)
      ? [src.replace(/\.webp$/, '.jpg')]
      : [],
  );
  return [...new Set([...supplied, ...formats])].filter((src) => src !== '/icon.svg').slice(0, 4);
}
