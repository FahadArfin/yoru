const CACHE = 'yoru-shell-v1';
// Public catalog artwork only. Account/extension cover URLs must always reach the server.
const COVERS = 'yoru-public-covers-v1';
const MAX_COVERS = 160;
const MAX_COVER_BYTES = 256 * 1024;
const DAY = 86400000;
const pendingCovers = new Map();
let coverWrites = Promise.resolve();

function isPublicCover(request) {
  if (request.method !== 'GET' || request.destination !== 'image') return false;
  const url = new URL(request.url);
  return (
    url.protocol === 'https:' &&
    !url.search &&
    ((url.hostname === 'cdn.myanimelist.net' &&
      /^\/images\/(?:anime|manga)\/\d+\/\d+l?\.(?:webp|jpg|png)$/.test(url.pathname)) ||
      (url.hostname === 'media.kitsu.app' &&
        /^\/(?:anime|manga)\/poster_images\//.test(url.pathname)))
  );
}

function saveCover(cache, url, response) {
  const policy = response.headers.get('cache-control') || '';
  if (
    !cache ||
    !response.ok ||
    !/^image\//i.test(response.headers.get('content-type') || '') ||
    /no-store|private|no-cache|must-revalidate/i.test(policy) ||
    Number(response.headers.get('content-length')) > MAX_COVER_BYTES
  )
    return;
  const copy = response.clone();
  coverWrites = coverWrites
    .then(async () => {
      const body = await copy.blob();
      if (body.size > MAX_COVER_BYTES) return;
      const headers = new Headers(copy.headers);
      const maxAge = /(?:^|,)\s*max-age=(\d+)/i.exec(policy);
      const remaining = Math.max(
        0,
        (maxAge ? Number(maxAge[1]) : 86400) - Number(headers.get('age') || 0),
      );
      headers.set('x-yoru-cover-time', String(Date.now()));
      headers.set('x-yoru-cover-ttl', String(Math.min(7 * DAY, remaining * 1000)));
      // Fetch exposes decoded bytes; don't retain their original transfer encoding.
      headers.delete('content-encoding');
      headers.delete('content-length');
      await cache.delete(url);
      await cache.put(url, new Response(body, { headers }));
      const keys = await cache.keys();
      await Promise.all(
        keys.slice(0, Math.max(0, keys.length - MAX_COVERS)).map((key) => cache.delete(key)),
      );
    })
    .catch(() => {});
}

async function publicCover(request) {
  const cache = await caches.open(COVERS).catch(() => null);
  const cached = await cache?.match(request.url).catch(() => null);
  const age = cached ? Date.now() - Number(cached.headers.get('x-yoru-cover-time') || 0) : Infinity;
  if (cached && age >= 0 && age < Number(cached.headers.get('x-yoru-cover-ttl'))) return cached;
  if (!pendingCovers.has(request.url)) {
    const work = (async () => {
      try {
        // CORS lets us check status/type/size; never persist opaque error responses.
        const response = await fetch(
          new Request(request.url, {
            mode: 'cors',
            credentials: 'omit',
            referrerPolicy: 'no-referrer',
          }),
        );
        if (!response.ok && cached && age < 30 * DAY) return cached;
        saveCover(cache, request.url, response);
        return response;
      } catch {
        if (cached && age < 30 * DAY) return cached;
        // A CDN without CORS may still display normally; leave its caching to the browser.
        return fetch(request);
      }
    })().finally(() => pendingCovers.delete(request.url));
    pendingCovers.set(request.url, work);
  }
  return (await pendingCovers.get(request.url)).clone();
}
self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(['/offline.html', '/icon.svg'])));
  self.skipWaiting();
});
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith('yoru-') && key !== CACHE && key !== COVERS)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});
self.addEventListener('fetch', (event) => {
  if (isPublicCover(event.request)) {
    const response = publicCover(event.request);
    event.respondWith(response);
    event.waitUntil(response.then(() => coverWrites).catch(() => {}));
    return;
  }
  if (event.request.method !== 'GET' || event.request.mode !== 'navigate') return;
  event.respondWith(fetch(event.request).catch(() => caches.match('/offline.html')));
});
