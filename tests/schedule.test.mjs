import test from 'node:test';
import assert from 'node:assert/strict';
import { getSchedule, normalizeAiring } from '../server/schedule-core.js';
import { localDateKey, weekStart, weekDays, airingLabel, isoWeek } from '../shared/schedule.js';

const now = Date.parse('2026-10-12T12:00:00Z');
const fixture = {
  route: 'test-show',
  title: 'Test show',
  episodeDate: '2026-10-12T00:30:00+09:00',
  episodeNumber: 3,
  airType: 'raw',
  imageVersionRoute: 'test.jpg',
};
test('local days cross date lines and honor daylight saving changes', () => {
  assert.equal(localDateKey(fixture.episodeDate, 'America/New_York'), '2026-10-11');
  assert.equal(localDateKey(fixture.episodeDate, 'Asia/Tokyo'), '2026-10-12');
  assert.equal(weekStart('2027-01-01'), '2026-12-28');
  assert.deepEqual(isoWeek('2027-01-07'), { year: 2027, week: 1 });
  assert.deepEqual(isoWeek('2027-01-01'), { year: 2026, week: 53 });
  assert.equal(weekDays('2026-10-26').at(-1), '2026-11-01');
  const before = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hour: 'numeric',
  }).format(new Date('2026-11-01T05:30:00Z'));
  const after = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hour: 'numeric',
  }).format(new Date('2026-11-01T06:30:00Z'));
  assert.equal(before, after);
  assert.equal(airingLabel({ airingAt: null }, now), 'Time unconfirmed');
  assert.equal(airingLabel({ airingAt: new Date(now + 3600000).toISOString() }, now), 'In 1h');
});
test('schedule entries retain unknown times, delay state, and provider identity', () => {
  const item = normalizeAiring(fixture);
  assert.equal(item.airingAt, '2026-10-11T15:30:00.000Z');
  assert.equal(item.providerUrl, 'https://animeschedule.net/anime/test-show');
  assert.equal(item.mediaId, undefined, 'Never fabricate MAL IDs from titles');
  const delayed = normalizeAiring({
    ...fixture,
    episodeDate: '0001-01-01T00:00:00Z',
    delayedText: 'On break',
    airingStatus: 'delayed-air',
  });
  assert.equal(delayed.airingAt, null);
  assert.equal(airingLabel(delayed, now), 'Delayed');
  assert.equal(normalizeAiring({ ...fixture, route: '../bad' }), null);
  assert.ok(normalizeAiring({ ...fixture, route: 'a'.repeat(220) }));
  assert.equal(normalizeAiring({ ...fixture, donghua: true }).donghua, true);
  assert.equal(normalizeAiring({ ...fixture, donghua: false }).donghua, false);
  assert.equal(normalizeAiring({ ...fixture, donghua: 'false' }).donghua, false);
});
test('shared UTC weeks are cached, stale data survives outages, and secrets stay server-side', async () => {
  const rows = new Map();
  let calls = 0,
    fail = false;
  const options = {
    token: 'test-private-token',
    now,
    load: async (key) => rows.get(key),
    save: async (key, value) => rows.set(key, value),
    fetchImpl: async (url, init) => {
      calls++;
      assert.equal(new URL(url).origin, 'https://animeschedule.net');
      assert.equal(new URL(url).searchParams.get('tz'), 'UTC');
      assert.equal(init.headers.Authorization, 'Bearer test-private-token');
      return fail ? new Response('', { status: 503 }) : Response.json([fixture]);
    },
  };
  const first = await getSchedule({ week: '2026-10-12' }, options);
  assert.equal(first.items.length, 1);
  assert.equal(first.stale, false);
  assert.equal(calls, 3, 'Adjacent UTC weeks cover both local week edges');
  await getSchedule({ week: '2026-10-12' }, options);
  assert.equal(calls, 3);
  fail = true;
  const stale = await getSchedule({ week: '2026-10-12' }, { ...options, now: now + 7200000 });
  assert.equal(stale.items.length, 1);
  assert.equal(stale.stale, true);
  assert.equal(stale.providerUnavailable, true);
  assert.equal(JSON.stringify(stale).includes(options.token), false);
});
test('missing credentials and malformed upstream data never masquerade as an empty valid schedule', async () => {
  const empty = await getSchedule(
    { week: '2026-10-12' },
    { now, token: '', load: async () => null },
  );
  assert.equal(empty.state, 'not-configured');
  const invalid = await getSchedule(
    { week: '2026-10-12' },
    {
      now,
      token: 'test',
      load: async () => null,
      save: async () => {
        throw Error('must not save');
      },
      fetchImpl: async () => Response.json({ error: 'bad response' }),
    },
  );
  assert.equal(invalid.state, 'unavailable');
  assert.equal(invalid.complete, false);
  await assert.rejects(() => getSchedule({ week: '1900-01-01' }, { now }), /week/i);
});

test('fresh old timetable caches refresh Chinese flags and survive a failed schema refresh', async () => {
  const old = {
    items: [{ ...normalizeAiring(fixture), donghua: undefined }],
    fetchedAt: now,
    complete: true,
  };
  const rows = new Map();
  const options = {
    now,
    token: 'test',
    load: async (key) => rows.get(key) || old,
    save: async (key, value) => rows.set(key, value),
  };
  const upgraded = await getSchedule(
    {},
    { ...options, fetchImpl: async () => Response.json([{ ...fixture, donghua: true }]) },
  );
  assert.equal(upgraded.items[0].donghua, true);
  assert.ok([...rows.values()].every((x) => x.schemaVersion === 2));
  const failed = await getSchedule(
    {},
    { ...options, load: async () => old, fetchImpl: async () => new Response('', { status: 503 }) },
  );
  assert.equal(failed.items.length, 1);
  assert.equal(failed.state, 'stale');
});

test('an outage lease bounds concurrent refreshes and permits a later retry', async () => {
  const leases = new Map();
  let calls = 0;
  const options = {
    now,
    token: 'test',
    load: async () => null,
    claim: async (key, time) => {
      if ((leases.get(key) || 0) > time) return false;
      leases.set(key, time + 120000);
      return true;
    },
    fetchImpl: async () => {
      calls++;
      return new Response('', { status: 503 });
    },
  };
  const results = await Promise.all(Array.from({ length: 41 }, () => getSchedule({}, options)));
  assert.equal(calls, 3);
  assert.ok(results.every((result) => result.state === 'unavailable'));
  await getSchedule({}, options);
  assert.equal(calls, 3);
  await getSchedule({}, { ...options, now: now + 120001 });
  assert.equal(calls, 6);
});
