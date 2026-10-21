import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// Resolve Vite's extensionless imports without bundling or replacing the actual
// tool implementation. The registry and network are synthetic browser seams.
let source = await readFile(new URL('../src/webmcp.js', import.meta.url), 'utf8');
for (const [specifier, file] of [
  ['./api', '../src/api.js'],
  ['../shared/anime-sources', '../shared/anime-sources.js'],
  ['./webmcp-state', '../src/webmcp-state.js'],
  ['../shared/media-reference', '../shared/media-reference.js'],
  [
    '../services/reader-bridge/suwayomi-operations.mjs',
    '../services/reader-bridge/suwayomi-operations.mjs',
  ],
])
  source = source.replaceAll(
    `from '${specifier}'`,
    `from '${new URL(file, import.meta.url).href}'`,
  );
const { setupWebMCP } = await import(
  'data:text/javascript;base64,' + Buffer.from(source).toString('base64')
);

const nativeId = 'ext-manga-' + 'a'.repeat(32);
function fixture(t, { ready = true, scope = 'account-a', expiresAt } = {}) {
  const names = ['document', 'navigator', 'location', 'window', 'fetch'];
  const saved = new Map(
    names.map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]),
  );
  const tools = {},
    requests = [],
    navigations = [];
  let selection = {
    ready,
    context: ready
      ? {
          owner: scope,
          scope,
          destination: 'yoru',
          integrationMode: 'extensions',
          selectionFingerprint: 'webmcp-fixture-' + Math.random(),
          expiresAt,
        }
      : null,
  };
  const media = {
    id: nativeId,
    title: 'Synthetic native title',
    category: 'MANGA',
    malId: null,
    sourceRef: { id: 'suwayomi:123', providerKey: 'MangaDex', integration: 'suwayomi' },
    provenance: { sourceField: 'synthetic fixture' },
    destination: 'yoru',
  };
  const registry = {
    registerTool: (tool) => {
      tools[tool.name] = tool;
    },
  };
  Object.defineProperties(globalThis, {
    document: { configurable: true, value: { modelContext: registry } },
    navigator: { configurable: true, value: {} },
    location: { configurable: true, value: { pathname: '/', search: '' } },
    window: { configurable: true, value: { location: { pathname: '/' } } },
    fetch: {
      configurable: true,
      value: async (path, options = {}) => {
        const url = new URL(path, 'http://yoru.local');
        requests.push({ url, options });
        if (url.pathname === '/api/auth/me') return Response.json({ user: { id: scope } });
        if (url.pathname === '/api/library' && options.method !== 'PUT')
          return Response.json({ items: [{ mediaId: nativeId, media, favorite: true }] });
        if (url.pathname.startsWith('/api/library/'))
          return Response.json({ item: { mediaId: nativeId, media, favorite: true } });
        if (url.pathname.includes('/media/')) return Response.json({ ...media, myRating: 4 });
        return Response.json({ items: [media], total: null, totalIsEstimate: true });
      },
    },
  });
  const cleanup = setupWebMCP((path) => navigations.push(path), {
    getReaderSelection: () => selection,
  });
  t.after(() => {
    cleanup();
    for (const [name, descriptor] of saved)
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
  });
  return {
    tools,
    requests,
    navigations,
    media,
    select: (next) => {
      selection = next;
    },
    decode: (result) => JSON.parse(result.content[0].text),
  };
}

test('general page tools handle native reading references but anime tools reject them', async (t) => {
  const f = fixture(t);
  const title = await f.tools.yoru_get_title.execute({ mediaId: nativeId });
  assert.notEqual(title.isError, true, JSON.stringify(f.decode(title)));
  assert.equal(f.decode(title).id, nativeId);
  assert.equal(f.decode(title).sourceRef.id, 'suwayomi:123');
  assert.equal(f.decode(title).destination, 'yoru');
  assert.equal(f.decode(title).malId, null);
  const saved = await f.tools.yoru_update_library.execute({ mediaId: nativeId, favorite: true });
  assert.notEqual(saved.isError, true, JSON.stringify(f.decode(saved)));
  assert.equal(f.decode(saved).item.mediaId, nativeId);
  const library = await f.tools.yoru_get_library.execute({});
  assert.equal(f.decode(library).items[0].mediaId, nativeId);
  for (const name of ['yoru_get_sources', 'yoru_open_episode']) {
    const count = f.requests.length;
    const invalid = await f.tools[name].execute({ mediaId: nativeId });
    assert.equal(invalid.isError, true);
    assert.equal(f.requests.length, count, name + ' rejects before HTTP');
    assert.equal(
      new RegExp(f.tools[name].inputSchema.properties.mediaId.pattern).test(nativeId),
      false,
    );
  }
});

test('general tools propagate the current selection and cannot inject destination or account ownership', async (t) => {
  const f = fixture(t);
  await f.tools.yoru_get_title.execute({ mediaId: 'mal-manga-21' });
  assert.equal(f.requests.at(-1).url.searchParams.get('destination'), 'yoru');
  assert.equal(f.requests.at(-1).url.searchParams.get('integration'), 'extensions');
  assert.match(f.requests.at(-1).url.searchParams.get('selectionFingerprint'), /^webmcp-fixture-/);
  for (const injected of [
    { owner: 'account-b' },
    { userId: 'account-b' },
    { destination: 'ara-ara' },
  ]) {
    const count = f.requests.length;
    const result = await f.tools.yoru_update_library.execute({
      mediaId: nativeId,
      favorite: true,
      ...injected,
    });
    assert.equal(result.isError, true);
    assert.equal(f.requests.length, count, 'injected ownership is rejected before HTTP');
  }
  const context = {
    owner: 'account-b',
    scope: 'account-b',
    destination: 'ara-ara',
    integrationMode: 'all',
    selectionFingerprint: 'changed-owner',
  };
  f.select({ ready: true, context });
  await f.tools.yoru_get_library.execute({});
  assert.equal(f.requests.at(-1).url.searchParams.get('destination'), 'ara-ara');
  assert.equal(f.requests.at(-1).url.searchParams.get('selectionFingerprint'), 'changed-owner');
});

test('unconfirmed or expired selection prevents tool content and account requests', async (t) => {
  const f = fixture(t, { ready: false });
  for (const name of [
    'yoru_search_catalog',
    'yoru_get_title',
    'yoru_get_library',
    'yoru_update_library',
    'yoru_list_rooms',
    'yoru_open_title',
  ]) {
    const args =
      name.includes('title') || name === 'yoru_update_library'
        ? { mediaId: nativeId, ...(name === 'yoru_update_library' ? { favorite: true } : {}) }
        : {};
    assert.equal((await f.tools[name].execute(args)).isError, true, name);
  }
  assert.equal(f.requests.length, 0);
  f.select({
    ready: true,
    context: {
      owner: 'guest',
      scope: 'guest',
      destination: 'yoru',
      integrationMode: 'all',
      selectionFingerprint: 'expired',
      expiresAt: Date.now() - 1,
    },
  });
  assert.equal((await f.tools.yoru_get_title.execute({ mediaId: 'mal-manga-21' })).isError, true);
  assert.equal(f.requests.length, 0);
});

test('unknown identity tools use public defaults without cookies or personal ratings', async (t) => {
  const f = fixture(t, { scope: null });
  const title = await f.tools.yoru_get_title.execute({ mediaId: 'mal-manga-21' });
  assert.notEqual(title.isError, true);
  assert.equal(f.requests.at(-1).options.credentials, 'omit');
  assert.equal(f.decode(title).myRating, 0);
});

test('tool cancellation reaches selected-context transport before a response is returned', async (t) => {
  const f = fixture(t);
  const controller = new AbortController();
  controller.abort();
  const result = await f.tools.yoru_get_title.execute(
    { mediaId: nativeId },
    { signal: controller.signal },
  );
  assert.equal(result.isError, true);
  assert.equal(f.decode(result).code, 'CANCELLED');
  assert.equal(f.requests.length, 0);
});

test('a late tool response cannot publish across an account or destination change', async (t) => {
  const f = fixture(t);
  let finish;
  globalThis.fetch = () =>
    new Promise((resolve) => {
      finish = resolve;
    });
  const pending = f.tools.yoru_get_title.execute({ mediaId: nativeId });
  f.select({
    ready: true,
    context: {
      owner: 'account-b',
      scope: 'account-b',
      destination: 'ara-ara',
      integrationMode: 'all',
      selectionFingerprint: 'late-change',
    },
  });
  finish(Response.json(f.media));
  const value = await pending;
  assert.equal(value.isError, true);
  assert.equal(f.decode(value).id, undefined);
});

test('reading search follows opaque continuation with exact source and language filters', async (t) => {
  const f = fixture(t);
  const continuedId = 'ext-manga-' + 'c'.repeat(32);
  globalThis.fetch = async (path, options) => {
    const url = new URL(path, 'http://yoru.local');
    f.requests.push({ url, options });
    const continued = url.searchParams.has('cursor');
    return Response.json({
      items: [{ ...f.media, id: continued ? continuedId : nativeId }],
      nextCursor: continued ? null : 'opaque-next',
      hasMore: !continued,
      total: null,
    });
  };
  const args = { query: 'native', category: 'MANGA', sourceId: 'suwayomi:123', language: 'en' };
  const first = await f.tools.yoru_search_catalog.execute(args);
  assert.notEqual(first.isError, true, JSON.stringify(f.decode(first)));
  const second = await f.tools.yoru_search_catalog.execute({
    ...args,
    cursor: f.decode(first).nextCursor,
  });
  assert.notEqual(second.isError, true);
  assert.equal(f.decode(second).items[0].id, continuedId);
  assert.equal(f.requests.at(-1).url.searchParams.get('cursor'), 'opaque-next');
  assert.equal(f.requests.at(-1).url.searchParams.get('source'), 'suwayomi:123');
  assert.equal(f.requests.at(-1).url.searchParams.get('q'), 'native');
  assert.equal(f.requests.at(-1).url.searchParams.get('language'), 'en');
  const count = f.requests.length;
  for (const bad of [
    { ...args, category: 'ANIME' },
    { ...args, cursor: 'é'.repeat(1025) },
    { ...args, sourceId: 'https://private.invalid' },
  ])
    assert.equal((await f.tools.yoru_search_catalog.execute(bad)).isError, true);
  assert.equal(f.requests.length, count, 'invalid filters fail before transport');
});

test('tool source filters preserve canonical signed64 boundaries and reject invalid IDs before HTTP', async (t) => {
  const f = fixture(t);
  for (const value of ['-9223372036854775808', '-1', '1', '9223372036854775807']) {
    const result = await f.tools.yoru_search_catalog.execute({
      query: 'boundary',
      category: 'MANGA',
      sourceId: 'suwayomi:' + value,
    });
    assert.notEqual(result.isError, true, value + ': ' + JSON.stringify(f.decode(result)));
    assert.equal(f.requests.at(-1).url.searchParams.get('source'), 'suwayomi:' + value);
  }
  const count = f.requests.length;
  for (const sourceId of [
    'suwayomi:9223372036854775808',
    'suwayomi:-9223372036854775809',
    'suwayomi:0',
    'suwayomi:-0',
    'suwayomi:01',
    'suwayomi:-01',
    'suwayomi:+1',
    'suwayomi: 1',
    'suwayomi:1\n',
    'suwayomi:1.0',
    1,
    null,
  ]) {
    const result = await f.tools.yoru_search_catalog.execute({
      query: 'boundary',
      category: 'MANGA',
      sourceId,
    });
    assert.equal(result.isError, true, String(sourceId));
  }
  assert.equal(f.requests.length, count);
});
