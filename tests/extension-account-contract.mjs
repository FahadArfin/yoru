import assert from 'node:assert/strict';

export const accountClassification = (rating = 'safe') => ({
  rating,
  provenance: {
    sourceField: 'source.contentWarning',
    value: rating,
    checkedAt: '2026-10-19T00:00:00Z',
  },
});
export const accountSource = (id = '123', rating = 'safe', providerKey = 'MangaDex') => ({
  id: `suwayomi:${id}`,
  integration: 'suwayomi',
  upstreamSourceId: id,
  providerKey,
  language: 'en',
  classification: accountClassification(rating),
  bridgeInstance: 'account-fixture',
  capabilities: Object.fromEntries(
    ['popular', 'latest', 'search', 'details', 'chapters', 'pages', 'resolveLink'].map((k) => [
      k,
      'supported',
    ]),
  ),
});
export function accountProviderGate() {
  let active;
  return {
    holdProvider(key) {
      let entered, release;
      const enteredPromise = new Promise((done) => (entered = done)),
        released = new Promise((done) => (release = done));
      active = { key, entered, release, released };
      return { entered: enteredPromise };
    },
    releaseProvider() {
      const held = active;
      active = null;
      held?.release();
    },
    async wait(key) {
      const held = active;
      if (held?.key === key) {
        held.entered();
        await held.released;
      }
    },
  };
}
export async function extensionAccountContract({
  request,
  register,
  seedNative,
  inspectStored,
  changeInventory,
  seedEdition,
  providerDetails,
  holdProvider,
  releaseProvider,
  inspectAccountRows,
}) {
  const alice = await register('NativeAccountAlice'),
    bob = await register('NativeAccountBob');
  const media = await seedNative(accountSource(), '/title/account-safe');
  let saved = await request(`/api/library/${media.id}?destination=yoru`, {
    method: 'PUT',
    session: alice,
    body: { status: 'reading', progress: 3 },
  });
  assert.equal(saved.status, 200, 'source-native title saves without a MAL match');
  assert.equal(saved.body.item.media.id, media.id);
  assert.equal(saved.body.item.media.malId, null);
  const ownChapter = seedEdition ? await seedEdition(media, '/chapter/account-owned') : null;
  const stamp = Date.now();
  const progress = await request(`/api/resume/${media.id}?destination=yoru`, {
    method: 'PUT',
    session: alice,
    body: {
      owner: alice.user.id,
      number: 3,
      page: 8,
      chapterId: ownChapter?.id || '',
      updatedAt: stamp,
    },
  });
  assert.equal(progress.status, 200, 'native resume accepts canonical media without MAL');
  if (seedEdition) {
    const other = await seedNative(accountSource(), '/title/other-owner');
    const chapter = await seedEdition(other, '/chapter/owned-by-other');
    const rejected = await request(`/api/resume/${media.id}?destination=yoru`, {
      method: 'PUT',
      session: alice,
      body: {
        owner: alice.user.id,
        chapterId: chapter.id,
        number: 3,
        page: 99,
        updatedAt: stamp + 1,
      },
    });
    assert.equal(rejected.status, 404, 'an exact chapter cannot be rebound to another title');
    assert.equal((await inspectStored(alice.user.id, media.id)).page, 8);
  }
  assert.deepEqual((await request('/api/library', { session: bob })).body.items, []);
  // Current inventory changes alone must narrow a stored safe snapshot.
  await changeInventory([accountSource('123', 'adult')]);
  assert.equal(
    (await request('/api/library?limit=1', { session: alice })).body.items.some(
      (x) => x.mediaId === media.id,
    ),
    false,
  );
  assert.equal(
    (await inspectStored(alice.user.id, media.id)).page,
    8,
    'filtering never deletes saved progress',
  );
  const exported = await request('/api/library/export', { session: alice });
  assert.equal(exported.status, 200);
  const native = exported.body.items.find((x) => x.mediaId === media.id);
  assert.equal(native.identity.kind, 'extension-manga');
  assert.equal(native.identity.malId, null);
  assert.equal(native.destination, 'yoru');
  assert.equal(exported.body.resume.find((x) => x.mediaId === media.id).page, 8);
  assert.doesNotMatch(JSON.stringify(exported.body), /trycloudflare|localMangaId|Bearer/);
  await changeInventory([accountSource()]);
  assert.equal(
    (await request('/api/library?limit=1', { session: alice })).body.items[0].mediaId,
    media.id,
  );
  const candidates = [];
  for (let i = 0; i < 5; i++) {
    const source = accountSource(String(800 + i), 'safe', i === 4 ? 'Cubari' : 'MangaDex');
    const title = await seedNative(source, `/title/page-${i}`);
    assert.equal(
      (
        await request(`/api/library/${title.id}?destination=yoru`, {
          method: 'PUT',
          session: alice,
          body: { status: 'reading', progress: 1 },
        })
      ).status,
      200,
    );
    candidates.push({ source, title });
  }
  await changeInventory([
    accountSource(),
    ...candidates.map(({ source }, i) =>
      i >= 2 && i <= 3 ? { ...source, classification: accountClassification('adult') } : source,
    ),
  ]);
  const disable = await request('/api/reader/preferences', {
    method: 'PATCH',
    session: alice,
    body: { owner: alice.user.id, provider: 'Cubari', destination: 'yoru', enabled: false },
  });
  assert.equal(disable.status, 200);
  const priorDetails = providerDetails?.();
  const page = await request('/api/library?destination=yoru&limit=2', { session: alice });
  assert.equal(page.status, 200);
  assert.equal(
    page.body.items.length,
    2,
    'ineligible recent rows do not starve older eligible rows',
  );
  assert.deepEqual(
    new Set(page.body.items.map((x) => x.mediaId)),
    new Set(candidates.slice(0, 2).map((x) => x.title.id)),
  );
  if (providerDetails)
    assert.equal(
      providerDetails(),
      priorDetails,
      'account lists refresh inventory once, never each title',
    );
  const mode = await request('/api/reader/preferences', {
    method: 'PATCH',
    session: alice,
    body: { owner: alice.user.id, operation: 'mode', destination: 'yoru', mode: 'core' },
  });
  assert.equal(mode.status, 200);
  if (ownChapter)
    assert.equal(
      (await request('/api/resume?destination=yoru', { session: alice })).body.items.find(
        (item) => item.mediaId === media.id,
      ).chapterId,
      ownChapter.id,
      'changing browse mode never substitutes or drops the exact native edition',
    );
  assert.equal(
    (await request('/api/resume?destination=yoru', { session: alice })).body.items.find(
      (x) => x.mediaId === media.id,
    ).page,
    8,
    'discovery mode does not hide an exact saved edition',
  );
  assert.equal(
    (
      await request(`/api/library?destination=yoru&limit=2&cursor=${page.body.nextCursor}`, {
        session: alice,
      })
    ).status,
    409,
    'selection changes invalidate account cursors',
  );
  const disabled = await request('/api/reader/preferences', {
    method: 'PATCH',
    session: alice,
    body: { owner: alice.user.id, provider: 'MangaDex', destination: 'yoru', enabled: false },
  });
  assert.equal(disabled.status, 200);
  assert.equal(
    (await request('/api/resume?destination=yoru', { session: alice })).body.items.length,
    0,
  );
  assert.equal((await inspectStored(alice.user.id, media.id)).page, 8);
  await request('/api/reader/preferences', {
    method: 'PATCH',
    session: alice,
    body: { owner: alice.user.id, provider: 'MangaDex', destination: 'yoru', enabled: true },
  });
  assert.equal(
    (await request('/api/resume?destination=yoru', { session: alice })).body.items.find(
      (x) => x.mediaId === media.id,
    ).page,
    8,
  );
  const padded = Array.from({ length: 405 }, (_, i) =>
    accountSource(String(10000 + i), 'safe', `Unconfigured ${i}`),
  );
  await changeInventory([...padded, accountSource()]);
  const incomplete = await request('/api/resume?destination=yoru', { session: alice });
  assert.equal(incomplete.status, 200);
  assert.equal(incomplete.body.inventoryComplete, false);
  assert.deepEqual(incomplete.body.items, []);
  assert.match(
    incomplete.body.sourceCursor,
    /^[a-f0-9]{32}$/,
    'bounded inventory exposes a private continuation rather than claiming complete absence',
  );
  assert.equal(
    (await request(`/api/resume?sourceCursor=${incomplete.body.sourceCursor}`, { session: bob }))
      .status,
    409,
  );
  const inventoryNext = await request(`/api/resume?sourceCursor=${incomplete.body.sourceCursor}`, {
    session: alice,
  });
  assert.equal(inventoryNext.body.inventoryComplete, true);
  assert.equal(inventoryNext.body.items.find((item) => item.mediaId === media.id).page, 8);
  await changeInventory([accountSource()]);
  if (holdProvider) {
    const waiting = await seedNative(accountSource(), '/title/awaiting-preferences');
    let gate = holdProvider(waiting.upstreamRef.upstreamKey);
    let pending = request(`/api/library/${waiting.id}?destination=yoru`, {
      method: 'PUT',
      session: alice,
      body: { status: 'reading', progress: 5 },
    });
    await gate.entered;
    await request('/api/reader/preferences', {
      method: 'PATCH',
      session: alice,
      body: { owner: alice.user.id, provider: 'MangaDex', destination: 'yoru', enabled: false },
    });
    releaseProvider();
    assert.equal(
      (await pending).status,
      404,
      'preferences changed during provider wait reject the save',
    );
    assert.deepEqual(await inspectAccountRows(alice.user.id, waiting.id), {
      library: 0,
      resume: 0,
    });
    await request('/api/reader/preferences', {
      method: 'PATCH',
      session: alice,
      body: { owner: alice.user.id, provider: 'MangaDex', destination: 'yoru', enabled: true },
    });
    gate = holdProvider(waiting.upstreamRef.upstreamKey);
    pending = request(`/api/resume/${waiting.id}?destination=yoru`, {
      method: 'PUT',
      session: alice,
      body: { owner: alice.user.id, number: 5, page: 8, updatedAt: Date.now() },
    });
    await gate.entered;
    assert.equal(
      (await request('/api/auth/logout', { method: 'POST', session: alice, body: {} })).status,
      200,
    );
    releaseProvider();
    assert.equal((await pending).status, 401, 'revoked live session rejects delayed progress');
    assert.deepEqual(await inspectAccountRows(alice.user.id, waiting.id), {
      library: 0,
      resume: 0,
    });
  }
}
