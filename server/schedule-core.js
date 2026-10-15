import { DAY_MS, isoWeek, shiftDate, weekStart } from '../shared/schedule.js';
const API = 'https://animeschedule.net/api/v3';
const TTL = 30 * 60000;
const plain = (value) =>
  typeof value === 'string' ? value.replace(/<[^>]*>/g, '').slice(0, 400) : '';
const validDate = (value) =>
  typeof value === 'string' &&
  /^\d{4}-\d\d-\d\dT.*(?:Z|[+-]\d\d:\d\d)$/.test(value) &&
  Number.isFinite(Date.parse(value)) &&
  Date.parse(value) > Date.UTC(2000, 0, 1)
    ? new Date(value).toISOString()
    : null;
export function normalizeAiring(raw) {
  if (
    !raw ||
    !/^[a-z0-9][a-z0-9-]{0,999}$/.test(raw.route || '') ||
    !['raw', 'sub', 'dub'].includes(raw.airType)
  )
    return null;
  const airingAt = validDate(raw.episodeDate);
  const episode =
    Number.isInteger(raw.episodeNumber) && raw.episodeNumber > 0 ? raw.episodeNumber : null;
  const image =
    typeof raw.imageVersionRoute === 'string' &&
    /^[a-zA-Z0-9_./-]+$/.test(raw.imageVersionRoute) &&
    !raw.imageVersionRoute.includes('..')
      ? raw.imageVersionRoute
      : null;
  return {
    id: `${raw.route}:${raw.airType}:${episode ?? 'unknown'}:${airingAt ?? 'unknown'}`,
    title: plain(raw.english || raw.title || raw.romaji) || 'Untitled',
    route: raw.route,
    airType: raw.airType,
    donghua: raw.donghua === true,
    episode,
    airingAt,
    delayed:
      raw.status === 'Delayed' || raw.airingStatus === 'delayed-air' || Boolean(raw.delayedText),
    delayNote: plain(raw.delayedText),
    delayedUntil: validDate(raw.delayedUntil),
    cover: image
      ? `https://img.animeschedule.net/production/assets/public/img/${image}`
      : '/icon.svg',
    providerUrl: `https://animeschedule.net/anime/${raw.route}`,
  };
}
async function readTimetable(response) {
  if (!response.ok) throw new Error('Schedule provider unavailable');
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 3 * 1024 * 1024) throw new Error('Schedule response too large');
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  const data = JSON.parse(new TextDecoder().decode(bytes));
  if (!Array.isArray(data) || data.length > 5000) throw new Error('Invalid timetable');
  const items = data.map(normalizeAiring).filter(Boolean);
  if (data.length && !items.length) throw new Error('Invalid timetable entries');
  return { items, complete: items.length === data.length, schemaVersion: 2 };
}
export async function getSchedule(input = {}, options = {}) {
  const {
    token = '',
    now = Date.now(),
    load = async () => null,
    save = async () => {},
    claim = async () => true,
    fetchImpl = fetch,
  } = options;
  const current = weekStart(new Date(now).toISOString().slice(0, 10));
  const requested = input.week || current;
  if (
    !/^\d{4}-\d\d-\d\d$/.test(requested) ||
    !Number.isFinite(Date.parse(requested)) ||
    new Date(`${requested}T12:00:00Z`).toISOString().slice(0, 10) !== requested ||
    Math.abs(Date.parse(requested) - Date.parse(current)) > 14 * DAY_MS
  ) {
    const error = new Error('Choose a week near the current date.');
    error.status = 400;
    throw error;
  }
  const start = weekStart(requested);
  const result = {
    items: [],
    source: 'AnimeSchedule.net',
    sourceUrl: 'https://animeschedule.net',
    updatedAt: null,
    stale: false,
    providerUnavailable: false,
    complete: true,
    state: 'ready',
    week: start,
  };
  // A local Monday-Sunday week can cross both neighboring UTC week boundaries.
  const weeks = [-1, 0, 7].map((offset) => isoWeek(shiftDate(start, offset)));
  for (const [index, { year, week }] of weeks.entries()) {
    const key = `airing:v1:${year}:${week}`;
    let cached = await load(key).catch(() => null);
    if (!cached || cached.schemaVersion !== 2 || now - cached.fetchedAt > TTL) {
      if (token.trim()) {
        // A shared two-minute lease bounds concurrent cold starts and outage retries.
        if (!(await claim(key, now).catch(() => false))) {
          cached = await load(key).catch(() => cached);
          result.providerUnavailable ||=
            !cached || cached.schemaVersion !== 2 || now - cached.fetchedAt > TTL;
        } else {
          try {
            const url = `${API}/timetables/all?year=${year}&week=${week}&tz=UTC`;
            const response = await fetchImpl(url, {
              headers: { Authorization: `Bearer ${token.trim()}`, Accept: 'application/json' },
              signal: AbortSignal.timeout(8000),
              redirect: 'manual',
            });
            const parsed = await readTimetable(response);
            const fresh = { ...parsed, fetchedAt: now };
            // An incomplete response must not replace the last complete timetable.
            if (parsed.complete || !cached) {
              cached = fresh;
              if (parsed.complete) await save(key, fresh).catch(() => {});
            } else result.providerUnavailable = true;
          } catch {
            result.providerUnavailable = true;
          }
        }
      }
    }
    if (cached && Array.isArray(cached.items)) {
      result.items.push(...cached.items.filter((item) => item.airingAt || index === 1));
      result.complete &&= cached.complete !== false;
      result.stale ||= now - cached.fetchedAt > TTL;
      const timestamp = new Date(cached.fetchedAt).toISOString();
      if (!result.updatedAt || timestamp < result.updatedAt) result.updatedAt = timestamp;
    } else {
      result.complete = false;
      result.stale = true;
    }
  }
  result.items = [...new Map(result.items.map((item) => [item.id, item])).values()].sort((a, b) =>
    (a.airingAt || '9999').localeCompare(b.airingAt || '9999'),
  );
  result.state = !token.trim()
    ? 'not-configured'
    : result.providerUnavailable
      ? result.updatedAt
        ? 'stale'
        : 'unavailable'
      : !result.complete
        ? 'partial'
        : 'ready';
  return result;
}
