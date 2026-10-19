import assert from 'node:assert/strict';
import { accountSource } from './extension-account-contract.mjs';
import { createExternalCatalogStore } from '../server/external-catalog-store.js';

export function socialSeeds(db, provider) {
  const store = createExternalCatalogStore(db);
  return {
    async seedNative(sourceRef, key) {
      const input = {
        sourceRef,
        upstreamRef: { sourceId: sourceRef.id, upstreamKey: key, language: 'en' },
        classification: sourceRef.classification,
        metadata: { title: key, category: 'MANGA', cover: 'http://private.invalid/cover' },
      };
      provider.titles.set(key, input);
      return store.rememberTitle(input);
    },
    async seedEdition(media, key, number) {
      const input = {
        sourceRef: media.sourceRef,
        upstreamRef: { title: media.upstreamRef, upstreamKey: key },
        metadata: { number, pages: 2 },
      };
      provider.editions.set(key, input);
      return store.rememberEdition(media.id, input);
    },
  };
}

export function socialProvider() {
  const sources = [accountSource('123'), accountSource('124', 'adult', 'Aunt Manhwa')];
  const titles = new Map(),
    editions = new Map();
  let inventoryCalls = 0;
  return {
    sources,
    titles,
    editions,
    get inventoryCalls() {
      return inventoryCalls;
    },
    async respond(path, input) {
      if (path === '/extension/catalogs') {
        inventoryCalls++;
        return { sources, nextCursor: null };
      }
      if (path === '/extension/details') {
        await this.beforeDetails?.(input);
        return titles.get(input.titleRef?.upstreamKey);
      }
      if (path === '/extension/chapter') return editions.get(input.editionRef?.upstreamKey);
      return null;
    },
  };
}

export async function nativeSocialContract({
  request,
  register,
  db,
  provider,
  seedNative,
  seedEdition,
  poll,
  events,
}) {
  const alice = await register('NativeSocialAlice'),
    bob = await register('NativeSocialBob');
  const safe = await seedNative(provider.sources[0], '/social/safe');
  const adult = await seedNative(provider.sources[1], '/social/adult');
  const other = await seedNative(provider.sources[1], '/social/other');
  const edition = await seedEdition(adult, '/social/chapter', '1');
  const wrong = await seedEdition(other, '/social/wrong', '1');
  const post = (path, body, session = alice) => request(path, { method: 'POST', body, session });
  let result = await post(`/api/comments/${adult.id}?destination=ara-ara`, {
    unit: 0,
    body: 'Undated title discussion',
  });
  assert.equal(result.status, 201, JSON.stringify(result.body));
  const comment = result.body.comment;
  assert.equal((await request(`/api/comments/${adult.id}`, { session: alice })).status, 404);
  assert.equal((await post(`/api/comments/${comment.id}/vote`, { value: 1 }, bob)).status, 404);
  assert.equal(
    (
      await post(`/api/comments/${adult.id}?destination=ara-ara`, {
        unit: 1,
        body: 'Number alone is not ownership',
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await post(`/api/comments/${adult.id}?destination=ara-ara`, {
        unit: 1,
        edition: wrong.id,
        body: 'Wrong exact owner',
      })
    ).status,
    404,
  );
  result = await post(`/api/comments/${adult.id}?destination=ara-ara`, {
    unit: 1,
    edition: edition.id,
    body: 'Exact chapter discussion',
  });
  assert.equal(result.status, 201, JSON.stringify(result.body));
  assert.equal(result.body.comment.editionId, edition.id);
  assert.equal(
    (
      await post(`/api/comments/${adult.id}?destination=ara-ara`, {
        unit: 1,
        edition: edition.id,
        parentId: comment.id,
        body: 'Wrong thread parent',
      })
    ).status,
    400,
  );
  const before = (await db.get('SELECT COUNT(*) AS n FROM chapter_opens')).n;
  assert.equal(
    (await post(`/api/media/${adult.id}/chapters/${wrong.id}/open?destination=ara-ara`, {})).status,
    404,
  );
  assert.equal((await db.get('SELECT COUNT(*) AS n FROM chapter_opens')).n, before);
  const ratingsBefore = (await db.get('SELECT COUNT(*) AS n FROM chapter_ratings')).n;
  assert.equal(
    (
      await post(`/api/media/${adult.id}/chapters/${wrong.id}/rating?destination=ara-ara`, {
        rating: 4,
      })
    ).status,
    404,
  );
  assert.equal((await db.get('SELECT COUNT(*) AS n FROM chapter_ratings')).n, ratingsBefore);
  result = await request('/api/community/threads?category=manga&destination=ara-ara', {
    session: alice,
  });
  assert.ok(
    result.body.items.some(
      (item) => item.mediaId === adult.id && item.unit === 0 && item.releasedAt === null,
    ),
  );
  for (let i = 0; i < 40; i++)
    await db.run(
      'INSERT INTO comments(id,user_id,media_id,unit,body,created_at) VALUES(?,?,?,?,?,?)',
      `hidden-recent-${i}`,
      alice.user.id,
      adult.id,
      0,
      'Hidden newer conversation',
      '2099-01-01T00:00:00Z',
    );
  await db.run(
    'INSERT INTO comments(id,user_id,media_id,unit,body,created_at) VALUES(?,?,?,?,?,?)',
    'older-eligible',
    alice.user.id,
    safe.id,
    0,
    'Older eligible conversation',
    '2000-01-01T00:00:00Z',
  );
  result = await request('/api/community', { session: alice });
  assert.ok(result.body.items.every((item) => item.mediaId !== adult.id));
  assert.ok(result.body.items.some((item) => item.id === 'older-eligible'));
  result = await post(`/api/reviews/${adult.id}?destination=ara-ara`, {
    title: 'Native review',
    body: 'A title without any MAL identity.',
    rating: 8,
  });
  assert.equal(result.status, 201);
  assert.equal((await request(`/api/reviews/${adult.id}`, { session: alice })).status, 404);

  const link = `/ara-ara/read/${adult.id}/1?source=${adult.sourceRef.id}&chapter=${edition.id}`;
  result = await post('/api/rooms?destination=ara-ara', {
    name: 'Private native reading',
    mediaId: adult.id,
    type: 'read',
    unit: 1,
    visibility: 'private',
    sourceKind: 'reader',
    sourceUrl: link,
    capacity: 2,
  });
  assert.equal(result.status, 201, JSON.stringify(result.body));
  const { room, invite } = result.body;
  assert.equal(room.destination, 'ara-ara');
  assert.match(room.sourceUrl, /^\/ara-ara\/read\//);
  assert.match(room.media.cover, /^\/api\/media\/.+destination=ara-ara$/);
  assert.equal(
    (await request(`/api/rooms/${room.id}?invite=${invite}`, { session: bob })).status,
    404,
  );
  result = await request(`/api/rooms/${room.id}?invite=${invite}&destination=ara-ara`, {
    session: bob,
  });
  assert.equal(result.status, 200);
  assert.equal(result.body.room.sourceUrl, '');
  assert.equal(result.body.room.readerSourceId, null);
  assert.equal(result.body.room.readerEditionId, null);
  assert.equal(result.body.room.joined, false);
  assert.equal((await post(`/api/rooms/${room.id}/join`, { invite }, bob)).status, 404);
  assert.equal(
    (await post(`/api/rooms/${room.id}/join?destination=ara-ara`, { invite }, bob)).status,
    200,
  );
  assert.equal(
    (
      await request(`/api/rooms/${room.id}?destination=ara-ara`, {
        method: 'PATCH',
        session: bob,
        body: { paused: false, version: room.version },
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await request(`/api/rooms/${room.id}`, {
        method: 'PATCH',
        session: alice,
        body: { paused: false, version: room.version },
      })
    ).status,
    404,
  );
  assert.equal((await request(`/api/rooms/${room.id}/chat`, { session: alice })).status, 404);
  assert.ok(
    [400, 404].includes(
      (
        await request(`/api/rooms/${room.id}?destination=ara-ara`, {
          method: 'PATCH',
          session: alice,
          body: { unit: 2 },
        })
      ).status,
    ),
  );
  assert.equal((await db.get('SELECT unit FROM rooms WHERE id=?', room.id)).unit, 1);
  const special = await seedEdition(adult, '/social/special', 'Extra');
  const changed = await request(`/api/rooms/${room.id}?destination=ara-ara`, {
    method: 'PATCH',
    session: alice,
    body: {
      unit: 1,
      sourceKind: 'reader',
      sourceUrl: `/ara-ara/read/${adult.id}/1?source=${adult.sourceRef.id}&chapter=${special.id}`,
      version: room.version,
    },
  });
  assert.equal(changed.status, 200, JSON.stringify(changed.body));
  assert.equal(changed.body.room.readerEditionId, special.id);
  const restored = await request(`/api/rooms/${room.id}?destination=ara-ara`, {
    method: 'PATCH',
    session: alice,
    body: { unit: 1, sourceKind: 'reader', sourceUrl: link, version: changed.body.room.version },
  });
  assert.equal(restored.status, 200, JSON.stringify(restored.body));
  assert.equal(
    (await request(`/api/rooms/${room.id}?destination=yoru&collection=ara-ara`, { session: alice }))
      .status,
    400,
  );
  if (poll) {
    assert.equal((await poll(room.id, alice, 'yoru')).status, 404);
    assert.equal((await poll(room.id, alice, 'ara-ara')).status, 200);
  }
  // Fixed list limits must be applied after policy. Seed older safe rooms behind
  // 65 newer hidden rooms without hitting the host's create cap.
  for (let i = 0; i < 67; i++)
    await db.run(
      'INSERT INTO rooms(id,host_id,name,media_id,type,visibility,capacity,unit,created_at,state_updated_at,destination) VALUES(?,?,?,?,?,?,?,?,?,?,?)',
      `native-list-${i}`,
      alice.user.id,
      'List room',
      i < 65 ? adult.id : safe.id,
      'read',
      'public',
      2,
      0,
      String(1000 - i),
      'now',
      'yoru',
    );
  const safeEdition = await seedEdition(safe, '/social/safe-chapter', '1');
  await db.run(
    "INSERT INTO rooms(id,host_id,name,media_id,type,visibility,capacity,unit,created_at,state_updated_at,destination,source_url,source_kind,reader_source_id,reader_edition_id) VALUES('native-list-invalid',?,'Invalid stored source',?,'read','public',2,1,'9999','now','yoru','https://private.invalid/reader','reader',?,?)",
    alice.user.id,
    safe.id,
    safe.sourceRef.id,
    safeEdition.id,
  );
  await db.run(
    "INSERT INTO room_members(room_id,user_id,joined_at,last_seen) SELECT id,host_id,?,? FROM rooms WHERE id LIKE 'native-list-%'",
    new Date().toISOString(),
    Date.now(),
  );
  const calls = provider.inventoryCalls;
  result = await request('/api/rooms', { session: alice });
  assert.equal(result.status, 200);
  assert.equal(result.body.items.filter((item) => item.mediaId === safe.id).length, 2);
  assert.equal(
    result.body.items.some((item) => item.mediaId === adult.id),
    false,
  );
  assert.equal(provider.inventoryCalls - calls, 1, 'one inventory for the entire list');
  assert.equal(
    (await post(`/api/media/${adult.id}/read-view?destination=ara-ara`, {})).status,
    200,
  );
  assert.equal((await post(`/api/media/${adult.id}/read-view`, {})).status, 404);
  assert.ok(
    (
      await request('/api/manga/discovery?mode=trending&destination=ara-ara', { session: alice })
    ).body.items.some((item) => item.id === adult.id),
  );
  if (events) {
    const global = await events('/api/events?destination=yoru', bob);
    try {
      await global.wait('snapshot');
      await post(`/api/comments/${adult.id}?destination=ara-ara`, {
        unit: 0,
        body: 'Hidden live title',
      });
      await post(`/api/comments/${safe.id}?destination=yoru`, {
        unit: 0,
        body: 'Visible live title',
      });
      assert.equal((await global.wait('comments')).mediaId, safe.id);
      assert.equal(
        global.received.some((item) => item.data.mediaId === adult.id),
        false,
      );
    } finally {
      await global.close?.();
    }
    const invalid = await events(`/api/events?roomId=${room.id}`, alice);
    assert.equal(invalid.status, 404);
    const live = await events(`/api/events?roomId=${room.id}&destination=ara-ara`, alice);
    try {
      assert.equal(live.status, 200);
      const snapshot = await live.wait('snapshot');
      assert.equal(snapshot.room.readerEditionId, edition.id);
      const disabled = await request('/api/reader/preferences', {
        method: 'PATCH',
        session: alice,
        body: {
          owner: alice.user.id,
          destination: 'ara-ara',
          provider: adult.sourceRef.providerKey,
          enabled: false,
        },
      });
      assert.equal(disabled.status, 200, JSON.stringify(disabled.body));
      assert.equal(
        (
          await post(`/api/rooms/${room.id}/chat?destination=ara-ara`, {
            body: 'Membership revoked',
          })
        ).status,
        404,
      );
      await post(
        `/api/rooms/${room.id}/chat?destination=ara-ara`,
        { body: 'Only authorized receivers' },
        bob,
      );
      await live.waitClosed();
      assert.equal(
        live.received.some((x) => x.event === 'chat'),
        false,
      );
    } finally {
      await live.close?.();
    }
  }
  assert.ok(
    (await request('/api/manga/discovery?mode=trending', { session: alice })).body.items.every(
      (item) => item.id !== adult.id,
    ),
  );
  // Leave remains possible even when the room is hidden in the caller's view.
  assert.equal((await post(`/api/rooms/${room.id}/leave`, {})).status, 200);
  const charlie = await register('NativeSocialRevoked');
  let release, entered;
  const started = new Promise((resolve) => {
      entered = resolve;
    }),
    hold = new Promise((resolve) => {
      release = resolve;
    });
  provider.beforeDetails = async () => {
    entered();
    await hold;
  };
  const beforeWait = (await db.get('SELECT COUNT(*) AS n FROM comments')).n;
  const pending = post(
    `/api/comments/${safe.id}?destination=yoru`,
    { unit: 1, edition: safeEdition.id, body: 'Must not survive revoked session' },
    charlie,
  );
  try {
    await started;
    await db.run('DELETE FROM sessions WHERE user_id=?', charlie.user.id);
  } finally {
    release();
    provider.beforeDetails = null;
  }
  assert.ok([401, 409].includes((await pending).status));
  assert.equal((await db.get('SELECT COUNT(*) AS n FROM comments')).n, beforeWait);
  const dave = await register('NativeSocialClassification');
  const began = new Promise((resolve) => {
      entered = resolve;
    }),
    pendingSource = new Promise((resolve) => {
      release = resolve;
    });
  provider.beforeDetails = async () => {
    entered();
    await pendingSource;
  };
  const stale = post(
    `/api/comments/${safe.id}?destination=yoru`,
    { unit: 1, edition: safeEdition.id, body: 'Must not overwrite newer adult evidence' },
    dave,
  );
  try {
    await began;
    await db.run(
      "UPDATE reader_sources SET classification=json_set(classification,'$.rating','adult'),updated_at=? WHERE id=?",
      new Date().toISOString(),
      safe.sourceRef.id,
    );
  } finally {
    release();
    provider.beforeDetails = null;
  }
  assert.ok([404, 409].includes((await stale).status));
  assert.equal((await db.get('SELECT COUNT(*) AS n FROM comments')).n, beforeWait);
  assert.equal(
    JSON.parse(
      (await db.get('SELECT classification FROM reader_sources WHERE id=?', safe.sourceRef.id))
        .classification,
    ).rating,
    'adult',
  );
}

export async function socialEventStream(response) {
  if (response.status !== 200) {
    await response.text();
    return { status: response.status };
  }
  const reader = response.body.getReader(),
    decoder = new TextDecoder(),
    received = [];
  let ended = false,
    buffer = '';
  const reading = (async () => {
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let boundary;
        while ((boundary = buffer.indexOf('\n\n')) >= 0) {
          const block = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);
          const event = block.match(/^event:\s*(.*)$/m)?.[1],
            data = block.match(/^data:\s*(.*)$/m)?.[1];
          if (event && data) received.push({ event, data: JSON.parse(data) });
        }
      }
    } finally {
      ended = true;
    }
  })();
  reading.catch(() => {});
  const until = async (predicate) => {
    const deadline = Date.now() + 12000;
    while (!predicate()) {
      if (Date.now() > deadline) throw new Error('Expected live event/closure');
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  };
  return {
    status: response.status,
    received,
    wait: async (event) => {
      await until(() => received.some((x) => x.event === event));
      return received.find((x) => x.event === event).data;
    },
    waitClosed: () => until(() => ended),
    close: async () => {
      await reader.cancel().catch(() => {});
      await reading.catch(() => {});
    },
  };
}
