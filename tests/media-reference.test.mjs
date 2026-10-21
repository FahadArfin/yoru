import assert from 'node:assert/strict';
import { test } from 'node:test';

test('legacy and native references remain distinct', async () => {
  const { parseMediaReference, parseEditionReference, mediaReferenceSchema } = await import(
    '../shared/media-reference.js'
  );
  assert.equal(parseMediaReference('mal-anime-1').kind, 'anime');
  assert.deepEqual(parseMediaReference('mal-manga-21'), { id: 'mal-manga-21', kind: 'manga' });
  const native = 'ext-manga-' + 'a'.repeat(32);
  assert.deepEqual(parseMediaReference(native), { id: native, kind: 'extension-manga' });
  assert.equal(parseEditionReference('ext-chapter-' + 'b'.repeat(32)).kind, 'extension');
  assert.equal(parseEditionReference('6e4a5f13-7388-49a9-aa37-681509d271ab').kind, 'mangadex');
  assert.equal(parseEditionReference('sw-weebcentral-1-2').kind, 'weebcentral');
  assert.equal(parseEditionReference('SW-WEEBCENTRAL-1-2')?.kind, 'weebcentral');
  for (const value of [
    null,
    {},
    1,
    'mal-anime-0',
    'mal-manga-01',
    'mal-anime-1000000000',
    'ext-manga-' + 'A'.repeat(32),
    'ext-manga-' + 'a'.repeat(31),
    'anything',
    native + '\n',
  ])
    assert.equal(parseMediaReference(value), null);
  for (const value of [
    Number.MAX_SAFE_INTEGER + 1,
    'sw-weebcentral-9007199254740992-1',
    'sw-weebcentral-1-0',
    'local-chapter-1',
    'ext-chapter-' + 'B'.repeat(32),
    'anything',
  ])
    assert.equal(parseEditionReference(value), null);
  assert.equal(mediaReferenceSchema.type, 'string');
  assert.equal(new RegExp(mediaReferenceSchema.pattern).test(native), true);
  assert.equal(new RegExp(mediaReferenceSchema.pattern).test('anything'), false);
  const { mediaId } = await import('../server/validation.js');
  assert.equal(mediaId(native), native);
  assert.throws(() => mediaId('anything'), { status: 400 });
  // Auth's legacy helper imports SQLite; isolate it from checkout/live data.
  const oldDatabase = process.env.YORU_DB_PATH;
  process.env.YORU_DB_PATH = ':memory:';
  try {
    const { mediaId: authMediaId } = await import('../server/auth.js');
    assert.equal(authMediaId(native), native);
    assert.throws(() => authMediaId('anything'), { status: 400 });
  } finally {
    if (oldDatabase === undefined) delete process.env.YORU_DB_PATH;
    else process.env.YORU_DB_PATH = oldDatabase;
    const { db } = await import('../server/db.js');
    db.close();
  }
  const { animeRequest } = await import('../shared/anime-sources.js');
  assert.throws(() => animeRequest(native), /anime title/);
});

test('selection input rejects forged or oversized projections', async () => {
  const {
    normalizeIntegrationMode,
    normalizeDestination,
    normalizeGuestSelection,
    selectionProjection,
  } = await import('../shared/catalog-selection.js');
  assert.equal(normalizeIntegrationMode('invalid'), 'all');
  assert.equal(normalizeIntegrationMode('extensions'), 'extensions');
  assert.equal(normalizeIntegrationMode('core'), 'core');
  assert.equal(normalizeDestination('ara-ara'), 'ara-ara');
  assert.equal(normalizeDestination('invalid'), 'yoru');
  assert.deepEqual(normalizeGuestSelection(), {
    overrides: {},
    modes: { yoru: 'all', 'ara-ara': 'all' },
  });
  const selection = {
    overrides: { MangaDex: { yoru: false }, 'Weeb Central': { 'ara-ara': true } },
    modes: { yoru: 'extensions', 'ara-ara': 'core' },
  };
  assert.deepEqual(normalizeGuestSelection(JSON.stringify(selection)), selection);
  assert.equal(
    JSON.stringify(
      selectionProjection({
        overrides: { 'Weeb Central': { 'ara-ara': true }, MangaDex: { yoru: false } },
        modes: { 'ara-ara': 'core', yoru: 'extensions' },
      }),
    ),
    '{"overrides":{"MangaDex":{"yoru":false},"Weeb Central":{"ara-ara":true}},"modes":{"yoru":"extensions","ara-ara":"core"}}',
  );
  assert.deepEqual(
    selectionProjection({ ...selection, owner: 'forged', userId: 'forged' }),
    selection,
  );
  for (const input of [
    { owner: 'forged', ...selection },
    { userId: 'forged' },
    { overrides: { MangaDex: { yoru: 'false' } } },
    { overrides: { MangaDex: { other: true } } },
    JSON.parse('{"overrides":{"__proto__":{"yoru":true}}}'),
    { overrides: { constructor: { yoru: true } } },
    { overrides: { ['x'.repeat(101)]: { yoru: true } } },
    {
      overrides: Object.fromEntries(
        Array.from({ length: 101 }, (_, i) => ['provider' + i, { yoru: true }]),
      ),
    },
    { modes: { constructor: 'all' } },
    { modes: { yoru: true } },
    { modes: { yoru: 'invalid' } },
    JSON.parse('{"overrides":{"prototype":{"yoru":true}}}'),
    JSON.parse('{"modes":{"__proto__":"all"}}'),
    { overrides: [] },
    '{"overrides":{},"modes":{}}' + ' '.repeat(16384),
    {
      overrides: Object.fromEntries(
        Array.from({ length: 100 }, (_, i) => [
          String(i) + '漢'.repeat(95),
          { yoru: true, 'ara-ara': false },
        ]),
      ),
    },
  ])
    assert.throws(() => normalizeGuestSelection(input), { status: 400 });
  const hundred = {
    overrides: Object.fromEntries(Array.from({ length: 100 }, (_, i) => ['p' + i, { yoru: true }])),
  };
  assert.equal(Object.keys(normalizeGuestSelection(hundred).overrides).length, 100);
  const { filterReadingSources } = await import('../shared/catalog-preferences.js');
  assert.deepEqual(
    filterReadingSources(
      [
        { id: 'suwayomi:1', name: 'wrong display', sourceRef: { providerKey: 'MangaDex' } },
        { id: 'suwayomi:2', name: 'MangaDex', sourceRef: { providerKey: 'Unknown' } },
        { id: 'suwayomi:3', name: 'wrong display', providerKey: 'MangaDex' },
      ],
      'yoru',
      {},
    ).map((source) => source.id),
    ['suwayomi:1', 'suwayomi:3'],
  );
});
