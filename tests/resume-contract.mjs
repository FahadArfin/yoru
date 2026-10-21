import assert from 'node:assert/strict';

export async function resumeContract(request, register) {
  const alice = await register('ResumeAlice'),
    bob = await register('ResumeBob');
  const now = Date.now();
  const put = (id, patch, session = alice) =>
    request(`/api/resume/${id}`, {
      method: 'PUT',
      session,
      body: { owner: session.user.id, updatedAt: now, number: 3, ...patch },
    });
  assert.equal((await request('/api/resume')).status, 401);
  for (const [id, patch] of [
    ['mal-anime-52991', { position: 127.5, language: 'dub' }],
    ['mal-manga-21', { chapterId: 'edition-a', number: 1.5, page: 8, language: 'en' }],
    ['mal-manga-121496', { chapterId: 'edition-b', page: 12, language: 'en' }],
  ])
    assert.equal((await put(id, patch)).status, 200);
  const items = (await request('/api/resume', { session: alice })).body.items;
  assert.equal(items.length, 3);
  assert.ok(
    items.every((item) => item.destination === 'yoru'),
    'omitted destination remains the legacy Yoru view',
  );
  const ara = await request('/api/resume?destination=ara-ara', { session: alice });
  assert.deepEqual(
    ara.body.items.map((item) => item.mediaId),
    ['mal-manga-21'],
  );
  assert.equal((await request('/api/resume?destination=unknown', { session: alice })).status, 400);
  const page = await request('/api/resume?limit=1', { session: alice });
  assert.equal(page.body.items.length, 1);
  assert.equal(page.body.hasMore, true);
  assert.equal(
    (await request(`/api/resume?limit=1&cursor=${page.body.nextCursor}`, { session: bob })).status,
    409,
  );
  assert.equal(
    (
      await request(`/api/resume?destination=ara-ara&limit=1&cursor=${page.body.nextCursor}`, {
        session: alice,
      })
    ).status,
    409,
  );
  assert.equal(items.find((x) => x.category === 'ANIME').position, 127.5);
  assert.equal(items.find((x) => x.category === 'MANHWA').page, 12);
  assert.equal(items.find((x) => x.category === 'MANGA').number, 1.5);
  assert.deepEqual((await request('/api/resume', { session: bob })).body.items, []);
  assert.equal((await put('mal-anime-52991', { owner: alice.user.id }, bob)).status, 409);
  assert.equal((await put('mal-anime-52991', { position: -1 })).status, 400);
  assert.equal((await put('mal-anime-52991', { number: 1.5 })).status, 400);
  const stale = await put('mal-anime-52991', { updatedAt: now - 10000, position: 2 });
  assert.equal(stale.body.item.position, 127.5);
  const rewind = await put('mal-anime-52991', { updatedAt: now + 1, position: 20 });
  assert.equal(rewind.body.item.position, 20);
}
