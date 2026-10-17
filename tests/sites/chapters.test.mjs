import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { Response } from 'miniflare';
import { createRuntime, migrate, sql } from './harness.mjs';

const manga = '85a12738-a597-48a6-baa1-2e4c87ab8b95';
const chapter = '556037fd-ca2e-4d00-959e-d6320cde8b31';
const wrongChapter = '8a3ba432-f940-44c6-a5a7-6a4e61a23049';
const media = {
  id: 'mal-manga-21',
  category: 'MANGA',
  title: 'One Piece',
  genres: [],
  fetchedAt: Date.now(),
  detailsFetchedAt: Date.now(),
};
const edition = {
  id: chapter,
  attributes: {
    chapter: '2',
    title: 'A chapter',
    translatedLanguage: 'en',
    pages: 25,
    publishAt: '2026-10-10T00:00:00Z',
  },
  relationships: [{ id: manga, type: 'manga' }],
};
let runtime,
  session,
  calls = 0;
async function provider(request) {
  const url = new URL(request.url);
  if (url.hostname !== 'api.mangadex.org') return new Response('No fixture', { status: 404 });
  calls++;
  if (url.pathname === '/manga')
    return Response.json({
      result: 'ok',
      data: [
        {
          id: manga,
          attributes: {
            links: { mal: '21' },
            contentRating: 'safe',
            availableTranslatedLanguages: ['en'],
          },
        },
      ],
    });
  if (url.pathname.includes('/feed'))
    return Response.json({ result: 'ok', data: [edition], total: 1, offset: 0, limit: 100 });
  return Response.json({
    result: 'ok',
    data: url.pathname.endsWith(wrongChapter)
      ? { ...edition, id: wrongChapter, relationships: [{ type: 'manga', id: 'another-manga' }] }
      : edition,
  });
}
async function request(
  instance,
  path,
  { body, cookie = '', origin = `http://${instance}.test` } = {},
) {
  const r = await runtime.dispatchFetch(
    `http://${instance}.test/api/media/${media.id}/chapters${path}`,
    {
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'content-type': 'application/json', origin, cookie },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    },
  );
  return { status: r.status, headers: r.headers, data: await r.json() };
}
before(async () => {
  runtime = await createRuntime({ provider, bindings: { CATALOG_OFFLINE: '0' } });
  await migrate(runtime);
  await sql(runtime, [
    [
      'INSERT INTO catalog_media(id,payload,fetched_at) VALUES(?,?,?)',
      media.id,
      JSON.stringify(media),
      Date.now(),
    ],
  ]);
  const r = await runtime.dispatchFetch('http://a.test/api/auth/register', {
    method: 'POST',
    headers: { origin: 'http://a.test', 'content-type': 'application/json' },
    body: JSON.stringify({
      name: 'Chapter reader',
      email: 'chapters@example.test',
      password: 'reader-password-123',
    }),
  });
  assert.equal(r.status, 201);
  session = r.headers.get('set-cookie').split(';')[0];
  await r.json();
});
after(async () => {
  await runtime?.dispose();
});
test('chapter feed, cache, opens and account ratings persist across Sites Workers', async () => {
  const [first, ...others] = await Promise.all(Array.from({ length: 6 }, () => request('a', '')));
  assert.equal(first.status, 200, JSON.stringify(first.data));
  assert.ok(others.every((result) => result.status === 200));
  assert.equal(calls, 2, 'concurrent readers share one mapping request and one chapter feed');
  assert.equal(first.data.items[0].title, 'A chapter');
  const beforeCalls = calls;
  await request('b', '');
  assert.equal(calls, beforeCalls, 'second Worker uses the shared provider cache');
  const opened = await request('a', `/${chapter}/open`, { body: {} });
  assert.equal(opened.status, 200, JSON.stringify(opened.data));
  const viewer = opened.headers.get('set-cookie').split(';')[0];
  assert.equal(
    (await request('b', `/${chapter}/open`, { body: {}, cookie: viewer })).data.opens,
    1,
  );
  assert.equal((await request('a', `/${chapter}/rating`, { body: { rating: 5 } })).status, 401);
  assert.equal(
    (await request('a', `/${chapter}/rating`, { body: { rating: 4 }, cookie: session })).status,
    200,
  );
  const changed = await request('b', `/${chapter}/rating`, {
    body: { rating: 5, userId: 'someone-else' },
    cookie: session,
  });
  assert.equal(changed.status, 200, JSON.stringify(changed.data));
  assert.equal(changed.data.votes, 1);
  assert.equal(changed.data.myRating, 5);
  const guest = (await request('b', '')).data.items[0].stats;
  assert.deepEqual(guest, { opens: 1, votes: 1, rating: 5, myRating: null });
  assert.equal(
    (await request('b', `/${wrongChapter}/open`, { body: {}, cookie: viewer })).status,
    404,
  );
  assert.equal(
    (await request('b', `/${chapter}/rating`, { body: { rating: 9 }, cookie: session })).status,
    400,
  );
  assert.equal(
    (
      await request('b', `/${chapter}/rating`, {
        body: { rating: 4 },
        cookie: session,
        origin: 'https://attacker.test',
      })
    ).status,
    403,
  );
});
