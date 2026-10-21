import test from 'node:test';
import assert from 'node:assert/strict';
import { getChapterCalendar, normalizeChapterRelease } from '../server/chapter-calendar.js';
import { localDayBounds } from '../shared/schedule.js';

const now = Date.parse('2026-10-18T12:00:00Z');
const mangaId = '11111111-1111-4111-8111-111111111111';
const chapterId = '22222222-2222-4222-8222-222222222222';
const chapter = (extra = {}, language = 'ja') => ({
  id: chapterId,
  attributes: {
    chapter: '4',
    title: 'A new day',
    translatedLanguage: 'en',
    pages: 22,
    publishAt: '2026-10-18T10:00:00Z',
    readableAt: '2026-10-18T10:00:00Z',
    ...extra,
  },
  relationships: [
    {
      id: mangaId,
      type: 'manga',
      attributes: {
        title: { en: 'A story' },
        originalLanguage: language,
        contentRating: 'safe',
        links: { mal: '123' },
      },
    },
    { id: mangaId, type: 'scanlation_group', attributes: { name: 'Example group' } },
  ],
});

test('calendar day boundaries honor local dates, DST and extreme offsets', () => {
  assert.deepEqual(localDayBounds('2026-11-01', 'America/New_York'), {
    start: '2026-11-01T04:00:00.000Z',
    end: '2026-11-02T05:00:00.000Z',
  });
  assert.deepEqual(localDayBounds('2026-03-08', 'America/New_York'), {
    start: '2026-03-08T05:00:00.000Z',
    end: '2026-03-09T04:00:00.000Z',
  });
  assert.equal(
    localDayBounds('2026-10-18', 'Pacific/Kiritimati').start,
    '2026-10-17T10:00:00.000Z',
  );
  assert.equal(localDayBounds('2026-10-18', 'Pacific/Pago_Pago').end, '2026-10-19T11:00:00.000Z');
});

test('calendar never invents extension release dates from chapter order or fetch timestamps', () => {
  const undated = chapter({ publishAt: undefined, readableAt: undefined });
  undated.attributes.chapter = '0.5';
  undated.attributes.sourceOrder = 17;
  undated.attributes.fetchedAt = String(now);
  undated.attributes.uploadDate = '0';
  assert.equal(normalizeChapterRelease(undated, 'manga', now), null);
  assert.equal(
    normalizeChapterRelease({ ...undated, id: 'ext-chapter-' + 'a'.repeat(32) }, 'manga', now),
    null,
  );
});

test('release normalization preserves source identity and excludes unsafe or misleading entries', () => {
  const item = normalizeChapterRelease(chapter(), 'manga', now);
  assert.equal(item.mediaId, 'mal-manga-123');
  assert.equal(item.providerUrl, `https://mangadex.org/chapter/${chapterId}`);
  assert.equal(item.status, 'released');
  assert.equal(normalizeChapterRelease(chapter(), 'manhwa', now), null);
  const adult = chapter();
  adult.relationships[0].attributes.contentRating = 'erotica';
  assert.equal(normalizeChapterRelease(adult, 'manga', now), null);
  assert.equal(normalizeChapterRelease(chapter({ isUnavailable: true }), 'manga', now), null);
  assert.equal(normalizeChapterRelease(chapter({ publishAt: 'invalid' }), 'manga', now), null);
  assert.equal(
    normalizeChapterRelease(chapter({ readableAt: '2026-10-19T10:00:00Z' }), 'manga', now),
    null,
  );
  const future = { publishAt: '2026-10-19T10:00:00Z', readableAt: '2026-10-19T10:00:00Z' };
  assert.equal(normalizeChapterRelease(chapter(future), 'manga', now).status, 'scheduled');
  assert.equal(
    normalizeChapterRelease(
      chapter({ ...future, readableAt: '2026-10-20T10:00:00Z' }),
      'manga',
      now,
    ),
    null,
    'A later readability date must not become a prematurely released cached entry',
  );
  assert.equal(
    normalizeChapterRelease(
      chapter({
        ...future,
        readableAt: '2021-10-19T10:00:00Z',
        pages: 0,
        externalUrl: 'https://mangaplus.shueisha.co.jp/viewer/1',
      }),
      'manga',
      now,
    ),
    null,
    'Old external placeholders are not upcoming releases',
  );
  const unmapped = chapter();
  unmapped.relationships[0].attributes.links.mal = '../1';
  assert.equal(normalizeChapterRelease(unmapped, 'manga', now).mediaId, null);
});

test('day feed is filtered, enriched, cached and keeps last-good releases during failures', async () => {
  const rows = new Map();
  let fail = false;
  let calls = 0;
  const options = {
    now,
    load: async (k) => rows.get(k),
    save: async (k, v) => rows.set(k, v),
    fetchImpl: async (url) => {
      calls++;
      if (fail) return new Response('', { status: 503 });
      const u = new URL(url);
      assert.equal(u.origin, 'https://api.mangadex.org');
      if (u.pathname === '/manga')
        return Response.json({
          result: 'ok',
          data: [
            {
              id: mangaId,
              relationships: [{ type: 'cover_art', attributes: { fileName: 'cover.jpg' } }],
            },
          ],
        });
      assert.equal(u.searchParams.get('originalLanguage[]'), 'ja');
      assert.equal(u.searchParams.get('translatedLanguage[]'), 'en');
      assert.equal(u.searchParams.get('publishAtSince'), '2026-10-18T04:00:00');
      assert.deepEqual(u.searchParams.getAll('contentRating[]'), ['safe', 'suggestive']);
      return Response.json({
        result: 'ok',
        data: [
          chapter(),
          chapter({ publishAt: '2026-10-19T05:00:00Z', readableAt: '2026-10-19T05:00:00Z' }),
        ],
        total: 2,
      });
    },
  };
  const input = { date: '2026-10-18', timezone: 'America/New_York', category: 'manga' };
  const fresh = await getChapterCalendar(input, options);
  assert.equal(fresh.state, 'ready');
  assert.equal(fresh.items.length, 1);
  assert.match(fresh.items[0].cover, /uploads.mangadex.org\/covers/);
  await getChapterCalendar(input, options);
  assert.equal(calls, 2);
  fail = true;
  const stale = await getChapterCalendar(input, { ...options, now: now + 3600000 });
  assert.equal(stale.state, 'stale');
  assert.equal(stale.items.length, 1);
  assert.equal(
    (await getChapterCalendar({ ...input, category: 'manhwa' }, { ...options, offline: true }))
      .state,
    'unavailable',
  );
});

test('query validation prevents arbitrary dates, categories, offsets and timezones', async () => {
  for (const input of [
    { category: 'anime' },
    { date: '2026-02-30' },
    { date: '2000-01-01' },
    { timezone: 'not/a/zone' },
    { offset: '-1' },
    { offset: '10000' },
    { language: '../../en' },
  ]) {
    await assert.rejects(getChapterCalendar(input, { now, offline: true }), { status: 400 });
  }
});

test('pagination continues through a busy day but stops at the next local day', async () => {
  let crossDay = false;
  const options = {
    now,
    fetchImpl: async (url) => {
      const u = new URL(url);
      if (u.pathname === '/manga') return Response.json({ result: 'ok', data: [] });
      assert.equal(u.searchParams.get('originalLanguage[]'), 'ko');
      assert.equal(u.searchParams.has('translatedLanguage[]'), false);
      const data = Array.from({ length: 100 }, (_, index) => ({
        ...chapter({}, 'ko'),
        id: `${String(index).padStart(8, '0')}-2222-4222-8222-222222222222`,
      }));
      if (crossDay)
        data[99] = chapter(
          { publishAt: '2026-10-19T05:00:00Z', readableAt: '2026-10-19T05:00:00Z' },
          'ko',
        );
      return Response.json({ result: 'ok', data, total: 200 });
    },
  };
  const input = {
    date: '2026-10-18',
    timezone: 'America/New_York',
    category: 'manhwa',
    language: 'all',
  };
  const first = await getChapterCalendar(input, options);
  assert.equal(first.items.length, 100);
  assert.equal(first.nextOffset, 100);
  crossDay = true;
  const second = await getChapterCalendar({ ...input, offset: 100 }, options);
  assert.equal(second.items.length, 99);
  assert.equal(second.nextOffset, null);
});
