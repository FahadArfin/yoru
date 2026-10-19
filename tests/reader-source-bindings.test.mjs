import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { source, manga } from './fixtures/suwayomi.mjs';

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'yoru-exact-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const state = {
    source: { ...source, baseUrl: 'https://example.invalid' },
    titles: [{ ...manga, thumbnailUrl: '/api/v1/manga/7/thumbnail' }],
    chapters: [
      {
        id: 11,
        mangaId: 7,
        url: '/series/new/start',
        name: 'Prologue',
        chapterNumber: 0,
        sourceOrder: 0,
        pageCount: 2,
      },
      {
        id: 12,
        mangaId: 7,
        url: '/series/new/half',
        name: 'Half',
        chapterNumber: 0.5,
        sourceOrder: 1,
        pageCount: 2,
      },
      {
        id: 13,
        mangaId: 7,
        url: '/series/new/special',
        name: 'Special',
        chapterNumber: -1,
        sourceOrder: 2,
        pageCount: 2,
      },
      {
        id: 14,
        mangaId: 7,
        url: '/series/new/alternate',
        name: 'Alternate',
        chapterNumber: 0.5,
        sourceOrder: 3,
        pageCount: 2,
      },
    ],
    pages: ['/api/v1/manga/7/chapter/1/page/0', '/api/v1/manga/7/chapter/1/page/1'],
    imageCalls: 0,
    now: 1000,
    imageType: 'image/png',
    imageBody: 'png',
    imageStatus: 200,
    bindingOverride: null,
    indexedHasMore: false,
    indexedCalls: 0,
    requests: [],
  };
  const { createSuwayomiClient } = await import('../services/reader-bridge/suwayomi-client.mjs');
  const client = createSuwayomiClient({
    url: 'http://fixture',
    limits: { imageBytes: 10 },
    fetchImpl: async (_url, options) => {
      if (options.method === 'GET') {
        state.imageCalls++;
        return new Response(state.imageBody, {
          status: state.imageStatus,
          headers: { 'content-type': state.imageType },
        });
      }
      const { query, variables: v } = JSON.parse(options.body);
      state.requests.push({ query, variables: v });
      let data;
      if (query.includes('SourceById')) data = { source: state.source };
      else if (query.includes('ExtensionSources'))
        data = { sources: { nodes: [state.source], pageInfo: { hasNextPage: false } } };
      else if (query.includes('RemoteFeed'))
        data = { fetchSourceManga: { mangas: state.titles, hasNextPage: false } };
      else if (query.includes('BindingTitles')) {
        state.indexedCalls++;
        data = { mangas: { nodes: state.titles, pageInfo: { hasNextPage: state.indexedHasMore } } };
      } else if (query.includes('BindingTitle'))
        data = { manga: state.bindingOverride || state.titles.find((x) => x.id === v.id) || null };
      else if (query.includes('RefreshDetails'))
        data = { fetchManga: { manga: state.titles.find((x) => x.id === v.input.id) } };
      else if (query.includes('ExtensionChapters'))
        data = {
          fetchMangaAndChapters: {
            manga: state.titles.find((x) => x.id === v.input.id),
            chapters: state.chapters,
          },
        };
      else if (query.includes('ExtensionPages')) {
        const chapter = state.chapters.find((x) => x.id === v.input.chapterId);
        data = {
          fetchChapterPages: {
            chapter: { ...chapter, manga: state.titles.find((x) => x.id === chapter.mangaId) },
            pages: state.pages,
          },
        };
      } else throw new Error('Unexpected exact-reading operation');
      return Response.json({ data });
    },
  });
  const { openSourceBindings } = await import('../services/reader-bridge/source-bindings.mjs');
  const { ExtensionProviders } = await import('../services/reader-bridge/extension-providers.mjs');
  const { ImageCache } = await import('../services/reader-bridge/cache.mjs');
  const bindings = await openSourceBindings({
    directory: join(directory, 'bindings'),
    client,
    now: () => state.now,
  });
  const images = new ImageCache(join(directory, 'images'), { ttl: 100, now: () => state.now });
  const provider = new ExtensionProviders({ client, bindings, images, now: () => state.now });
  const title = (await provider.browse({ sourceId: `suwayomi:${source.id}` })).items[0];
  return {
    state,
    directory,
    client,
    bindings,
    provider,
    images,
    title: title.upstreamRef,
    openSourceBindings,
  };
}

test('page bytes require exact source title and chapter ownership', async (t) => {
  const { state, provider, title, bindings } = await fixture(t);
  const edition = (await provider.chapters(title)).items[1].upstreamRef;
  for (const bad of [
    { title: { ...title, upstreamKey: '/series/other' }, upstreamKey: edition.upstreamKey },
    { ...edition, upstreamKey: '/series/new/missing' },
    { ...edition, title: { ...title, language: 'ja' } },
  ])
    await assert.rejects(provider.page(title, bad, 0), (e) => e.status === 409);
  assert.equal(state.imageCalls, 0);
  assert.equal(new TextDecoder().decode((await provider.page(title, edition, 0)).body), 'png');
  assert.equal((await provider.page(title, edition, 0)).cached, true);
  assert.equal(state.imageCalls, 1);
  state.chapters[1] = { ...state.chapters[1], url: '/series/new/wrong' };
  await assert.rejects(provider.page(title, edition, 0), (e) => e.status === 409);
  assert.equal(state.imageCalls, 1, 'ownership must precede cache bytes');
});

test('rebind and edition switching preserve identity', async (t) => {
  const f = await fixture(t),
    { state, provider, title, client } = f;
  const items = (await provider.chapters(title)).items;
  assert.deepEqual(
    items.map((x) => [x.metadata.number, x.metadata.title]),
    [
      ['0', 'Prologue'],
      ['0.5', 'Half'],
      ['', 'Special'],
      ['0.5', 'Alternate'],
    ],
  );
  assert.notDeepEqual(items[1].upstreamRef, items[3].upstreamRef);
  assert.equal(Object.hasOwn(items[3].metadata, 'progress'), false);
  const original = await f.bindings.instanceId();
  const reopened = await f.openSourceBindings({ directory: join(f.directory, 'bindings'), client });
  assert.equal(await reopened.instanceId(), original);
  state.titles = [
    { ...state.titles[0], id: 7, url: '/wrong' },
    { ...state.titles[0], id: 70 },
  ];
  state.chapters = state.chapters.map((x) => ({ ...x, id: x.id + 100, mangaId: 70 }));
  assert.equal((await reopened.resolveTitle(title)).localMangaId, '70');
  assert.equal((await reopened.resolveEdition(title, items[1].upstreamRef)).localChapterId, '112');
  state.titles.push({ ...state.titles[1], id: 71 });
  state.titles[1].url = '/changed-again';
  state.titles.push({ ...state.titles[2], id: 72 });
  await assert.rejects(reopened.resolveTitle(title), (e) => e.status === 409);
  state.source.lang = 'ja';
  await assert.rejects(reopened.resolveTitle(title), (e) => e.status === 409);
});

test('cover and page images validate returned owned paths and bounded safe bytes before caching', async (t) => {
  const { state, provider, title, images, bindings } = await fixture(t);
  const edition = (await provider.chapters(title)).items[1].upstreamRef;
  assert.equal((await provider.cover(title)).cached, false);
  assert.equal((await provider.cover(title)).cached, true);
  state.now += 101;
  await images.prune();
  assert.equal((await provider.cover(title)).cached, false);
  assert.equal((await bindings.resolveTitle(title)).localMangaId, '7');
  for (const path of [
    '/api/v1/manga/8/chapter/1/page/0',
    '/api/v1/manga/7/chapter/2/page/0',
    'https://evil.invalid/page',
    '//evil.invalid/page',
  ]) {
    state.pages = [path];
    await assert.rejects(provider.page(title, edition, 0));
  }
  state.pages = Array(501).fill('/api/v1/manga/7/chapter/1/page/0');
  await assert.rejects(provider.reader(title, edition));
  state.pages = ['/api/v1/manga/7/chapter/1/page/0'];
  await assert.rejects(provider.page(title, edition, 500));
  state.imageType = 'text/html';
  await assert.rejects(provider.page(title, edition, 0), (e) => e.status === 502);
  state.imageType = 'image/png';
  state.imageBody = 'x'.repeat(11);
  await assert.rejects(provider.page(title, edition, 0), (e) => e.status === 502);
  state.imageBody = 'png';
  state.imageStatus = 302;
  await assert.rejects(provider.page(title, edition, 0), (e) => e.status === 302);
  state.titles[0].thumbnailUrl = 'https://external.invalid/cover';
  await assert.rejects(provider.cover(title), (e) => e.status === 502);
});

test('production providers persist feed bindings and share one core/generic image budget', async (t) => {
  const { state, client, directory } = await fixture(t);
  const { Providers } = await import('../services/reader-bridge/providers.mjs');
  const provider = new Providers({
    directory: join(directory, 'production'),
    client,
    now: () => state.now,
  });
  assert.match(
    (await provider.extensions.catalogs()).sources[0].bridgeInstance || '',
    /^[a-f0-9-]{36}$/,
  );
  assert.equal(provider.images, provider.extensions.images);
  provider.images.maxBytes = 4;
  await provider.images.put('legacy-core-page', new Uint8Array([1, 2]), 'image/png');
  state.now++;
  const title = (await provider.extensions.browse({ sourceId: `suwayomi:${source.id}` })).items[0]
    .upstreamRef;
  assert.equal((await provider.extensions.details(title)).localMangaId, '7');
  await provider.extensions.cover(title);
  assert.equal(await provider.images.get('legacy-core-page'), null);
  state.now += 72 * 3600000 + 1;
  await provider.images.prune();
  assert.equal((await provider.extensions.details(title)).localMangaId, '7');
});

test('binding revalidation rejects a mismatched integer even when its canonical key matches', async (t) => {
  const { state, bindings, title } = await fixture(t);
  state.bindingOverride = { ...state.titles[0], id: 70 };
  state.titles = [];
  await assert.rejects(bindings.resolveTitle(title), (e) => e.status === 409);
});

test('exact indexed recovery requires complete enumeration within a hard operation cap', async (t) => {
  const { state, bindings, title } = await fixture(t);
  state.titles = [];
  state.indexedHasMore = true;
  await assert.rejects(bindings.resolveTitle(title), (e) => e.status === 409);
  assert.equal(state.indexedCalls, 10);
});

test('same-number chapters stay distinct and ambiguous or changed sources cannot serve cached bytes', async (t) => {
  const { state, provider, title } = await fixture(t);
  const editions = (await provider.chapters(title)).items;
  assert.equal((await provider.chapter(title, editions[3].upstreamRef)).localChapterId, '14');
  await provider.page(title, editions[1].upstreamRef, 0);
  state.chapters.push({ ...state.chapters[1], id: 20 });
  await assert.rejects(provider.page(title, editions[1].upstreamRef, 0), (e) => e.status === 409);
  state.source.extension = { pkgName: 'changed.provider', isInstalled: true };
  await assert.rejects(provider.cover(title), (e) => e.status === 409);
  assert.equal(state.imageCalls, 1);
});

test('singular generic routes deliver only opaque manifests and verified binary bytes behind the flag', async (t) => {
  const { provider, title } = await fixture(t);
  const { bridgeHandler } = await import('../services/reader-bridge/server.mjs');
  const key = 'x'.repeat(32);
  const request = (path, body = {}) =>
    new Request(`http://bridge${path}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${key}` },
      body: JSON.stringify(body),
    });
  const handler = bridgeHandler({
    key,
    provider: { extensions: provider },
    extensionsEnabled: true,
  });
  const disabled = bridgeHandler({
    key,
    provider: { extensions: provider },
    extensionsEnabled: false,
  });
  const editions = await (
    await handler(request('/extension/chapters', { titleRef: title }))
  ).json();
  const editionRef = editions.items[1].upstreamRef;
  for (const path of [
    '/extension/page',
    '/extension/cover',
    '/extension/reader',
    '/extensions/browse',
  ])
    assert.equal((await disabled(request(path))).status, 404);
  assert.equal((await handler(request('/extensions/browse'))).status, 404);
  const manifest = await (
    await handler(request('/extension/reader', { titleRef: title, editionRef }))
  ).json();
  assert.deepEqual(manifest.pages, [0, 1]);
  assert.equal(JSON.stringify(manifest).includes('/api/v1/'), false);
  const page = await handler(request('/extension/page', { titleRef: title, editionRef, page: 0 }));
  assert.equal(page.headers.get('content-type'), 'image/png');
  assert.equal(page.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(await page.text(), 'png');
  assert.equal((await handler(request('/extension/cover', { titleRef: title }))).status, 200);
  assert.equal(
    (
      await handler(
        request('/extension/resolve', {
          sourceId: title.sourceId,
          url: 'https://example.invalid/series/new',
        }),
      )
    ).status,
    422,
  );
});

test('new fixed operation variables and input objects match the installed schema contracts', async (t) => {
  const { state, provider, title, bindings } = await fixture(t);
  const edition = (await provider.chapters(title)).items[1].upstreamRef;
  await provider.reader(title, edition);
  await provider.details(title);
  state.bindingOverride = { ...state.titles[0], id: 70 };
  await bindings.resolveTitle(title);
  const schema = JSON.parse(
    await readFile(new URL('./fixtures/suwayomi-schema.json', import.meta.url)),
  );
  const types = new Map([...schema.roots, ...schema.types].map((x) => [x.name, x]));
  const nameOf = (type) => (type.ofType ? nameOf(type.ofType) : type.name);
  const validate = (value, type) => {
    if (type.kind === 'NON_NULL') {
      assert.notEqual(value, undefined);
      assert.notEqual(value, null);
      return validate(value, type.ofType);
    }
    if (value == null) return;
    const name = nameOf(type),
      definition = types.get(name);
    if (definition?.kind === 'INPUT_OBJECT') {
      for (const key of Object.keys(value))
        assert.ok(
          definition.inputFields.some((f) => f.name === key),
          `${name}.${key}`,
        );
      for (const field of definition.inputFields) validate(value[field.name], field.type);
    } else if (name === 'Int') assert.equal(Number.isInteger(value), true);
    else if (name === 'Boolean') assert.equal(typeof value, 'boolean');
    else if (['String', 'LongString'].includes(name)) assert.equal(typeof value, 'string');
  };
  for (const { query, variables } of state.requests) {
    const root = types.get(query.startsWith('mutation') ? 'Mutation' : 'Query');
    const rootField = query.match(/\{\s*(\w+)\s*\(/)[1];
    const field = root.fields.find((f) => f.name === rootField);
    assert.ok(field, rootField);
    for (const match of query.matchAll(/(\w+):\$(\w+)/g)) {
      const [, argument, variable] = match;
      const arg =
        field.args.find((a) => a.name === argument) ||
        (rootField === 'mangas' && argument === 'equalTo'
          ? types.get('LongFilterInput').inputFields.find((f) => f.name === 'equalTo')
          : null);
      assert.ok(arg, `${rootField}.${argument}`);
      const declaration = query.match(new RegExp(`\\$${variable}:([\\w!]+)`));
      assert.ok(declaration);
      assert.equal(declaration[1].replace('!', ''), nameOf(arg.type));
      validate(variables[variable], arg.type);
    }
  }
  const filter = types.get('MangaFilterInput').inputFields.find((f) => f.name === 'sourceId');
  const equalTo = types.get(nameOf(filter.type)).inputFields.find((f) => f.name === 'equalTo');
  assert.equal(nameOf(equalTo.type), 'LongString');
});
