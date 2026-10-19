import assert from 'node:assert/strict';
import { socialProvider, socialSeeds } from './native-social-contract.mjs';

export const rollbackCoreChapter = '11111111-1111-4111-8111-111111111111';
export function rollbackProvider() {
  const provider = socialProvider();
  const calls = [];
  return {
    ...provider,
    calls,
    async respond(path, input) {
      calls.push(path);
      if (['/page', '/extension/page', '/extension/cover'].includes(path))
        return { bytes: new Uint8Array([137, 80, 78, 71]), type: 'image/png' };
      if (path === '/sources')
        return {
          json: {
            mediaId: input.media.id,
            sources: [
              { id: 'mangadex', native: true },
              { id: 'weebcentral', native: true },
            ],
          },
        };
      if (path === '/chapters')
        return {
          json: {
            mediaId: input.media.id,
            items: [{ id: rollbackCoreChapter, number: '1', native: true }],
            hasMore: false,
          },
        };
      if (path === '/reader')
        return {
          json: {
            mediaId: input.media.id,
            chapter: { id: input.chapterId, number: '1', pages: [{}] },
          },
        };
      if (path === '/extension/reader')
        return {
          json: { edition: provider.editions.get(input.editionRef.upstreamKey), pages: [0] },
        };
      const json = await provider.respond(path, input);
      return json ? { json } : null;
    },
  };
}

export async function disabledRollbackContract({ request, db, provider, disable }) {
  const registered = await request('/api/auth/register', {
    method: 'POST',
    body: {
      name: 'RollbackOwner',
      email: 'rollback@example.test',
      password: 'correct-horse-battery',
    },
  });
  assert.equal(registered.status, 201, JSON.stringify(registered.body));
  const session = {
    user: registered.body.user,
    cookie: registered.headers.get('set-cookie').split(';')[0],
  };
  const { seedNative, seedEdition } = socialSeeds(db, provider);
  const media = await seedNative(provider.sources[1], '/rollback/non-explicit-synthetic-fixture');
  const edition = await seedEdition(media, '/rollback/synthetic-chapter', '1');
  const ara = '?destination=ara-ara';
  for (const [path, method, body, expected] of [
    [`/api/library/${media.id}${ara}`, 'PUT', { status: 'reading', progress: 1 }, 200],
    [
      `/api/resume/${media.id}${ara}`,
      'PUT',
      { owner: session.user.id, number: 1, page: 0, chapterId: edition.id, updatedAt: Date.now() },
      200,
    ],
    [
      `/api/comments/${media.id}${ara}`,
      'POST',
      { unit: 0, body: 'Synthetic rollback discussion' },
      201,
    ],
    [
      `/api/reviews/${media.id}${ara}`,
      'POST',
      { title: 'Synthetic rollback review', body: 'Non-explicit acceptance fixture.', rating: 8 },
      201,
    ],
  ]) {
    const response = await request(path, { method, body, session });
    assert.equal(response.status, expected, `${path}: ${JSON.stringify(response.body)}`);
  }
  const roomResponse = await request('/api/rooms' + ara, {
    method: 'POST',
    session,
    body: {
      name: 'Synthetic rollback room',
      mediaId: media.id,
      type: 'read',
      unit: 1,
      visibility: 'private',
      sourceKind: 'reader',
      sourceUrl: `/ara-ara/read/${media.id}/1?source=${media.sourceRef.id}&chapter=${edition.id}`,
      capacity: 2,
    },
  });
  assert.equal(roomResponse.status, 201, JSON.stringify(roomResponse.body));
  const room = roomResponse.body.room;
  const direct = [
    `/api/reader/media/${media.id}`,
    `/api/reader/media/${media.id}/cover`,
    `/api/media/${media.id}/cover`,
    `/api/media/${media.id}/reader/${edition.id}`,
    `/api/media/${media.id}/reader/${edition.id}/page/0`,
    `/api/comments/${media.id}`,
    `/api/reviews/${media.id}`,
    `/api/rooms/${room.id}`,
  ];
  // Positive controls demonstrate that each hidden identity really was usable.
  for (const path of direct) {
    const response = await request(path + ara, { session });
    assert.equal(response.status, 200, `enabled ${path}: ${JSON.stringify(response.body)}`);
  }
  for (const path of [
    '/api/library',
    '/api/resume',
    '/api/community',
    '/api/community/threads?category=manga',
  ]) {
    const response = await request(
      path + (path.includes('?') ? '&' : '?') + 'destination=ara-ara',
      { session },
    );
    assert.equal(response.status, 200);
    assert.ok(JSON.stringify(response.body).includes(media.id), `enabled retained row: ${path}`);
  }
  const retained = async () => {
    const result = {};
    for (const table of [
      'external_media',
      'external_editions',
      'library',
      'resume_progress',
      'reading_account_snapshots',
      'comments',
      'reviews',
      'rooms',
    ])
      result[table] = (await db.get(`SELECT COUNT(*) AS n FROM ${table}`)).n;
    result.resume = (
      await db.get(
        'SELECT payload FROM resume_progress WHERE user_id=? AND media_id=?',
        session.user.id,
        media.id,
      )
    ).payload;
    return result;
  };
  const before = await retained();
  await disable();
  const callsBefore = provider.calls.length;
  // The flag is disabled in a fresh Node process / distinct Worker on the same DB.
  for (const destination of ['yoru', 'ara-ara']) {
    const context = await request(`/api/reader/context?destination=${destination}`, { session });
    assert.equal(context.status, 200);
    for (const path of direct) {
      const response = await request(`${path}?destination=${destination}`, { session });
      assert.equal(response.status, 404, `disabled ${destination} ${path}`);
      assert.equal(response.headers.get('content-type')?.startsWith('image/'), false);
      assert.ok(!JSON.stringify(response.body).includes(media.id));
    }
    for (const path of [
      '/api/library',
      '/api/resume',
      '/api/community',
      '/api/community/threads?category=manga',
      '/api/rooms',
    ]) {
      const response = await request(
        path + (path.includes('?') ? '&' : '?') + `destination=${destination}`,
        { session },
      );
      assert.equal(response.status, 200, `disabled collection ${path}`);
      assert.ok(!JSON.stringify(response.body).includes(media.id), `hidden retained row: ${path}`);
    }
  }
  assert.equal(
    provider.calls.slice(callsBefore).some((path) => path.startsWith('/extension/')),
    false,
    'disabled runtime rejects before private generic operations',
  );
  const core = '/api/media/mal-manga-21';
  const sources = await request(`${core}/reading-sources?destination=yoru`, { session });
  assert.equal(sources.status, 200);
  assert.ok(sources.body.sources.some((source) => source.id === 'mangadex'));
  assert.ok(sources.body.sources.some((source) => source.id === 'weebcentral'));
  for (const path of [
    `${core}/chapters?source=mangadex`,
    `${core}/reader/${rollbackCoreChapter}`,
    `${core}/reader/${rollbackCoreChapter}/page/0`,
  ]) {
    const response = await request(path, { session });
    assert.equal(response.status, 200, `core remains available: ${path}`);
  }
  assert.deepEqual(
    await retained(),
    before,
    'rollback filters preserved additive records and exact resume payload',
  );
}
