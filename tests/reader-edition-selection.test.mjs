import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as model from '../src/reader/model.js';
import {
  chapterList,
  readerChapter,
  readingSources,
  warmReaderLink,
} from '../src/reader/requests.js';

const mediaId = `ext-manga-${'1'.repeat(32)}`;
const chapterId = `ext-chapter-${'2'.repeat(32)}`;
const sourceRef = {
  id: 'suwayomi:42',
  integration: 'suwayomi',
  providerKey: 'MangaDex',
  language: 'es',
};
const context = {
  owner: 'guest',
  scope: 'guest',
  destination: 'yoru',
  integrationMode: 'all',
  selectionFingerprint: 'reader-test',
  revision: 1,
  overrides: {},
  expiresAt: Date.now() + 60_000,
};
const native = { id: chapterId, mediaId, sourceRef, kind: 'remote', language: 'es', number: '0' };

test('native reader links retain exact source, language, destination, zero, decimals and specials', () => {
  for (const number of ['0', '1.5', 'Extra']) {
    const url = new URL(
      model.readerLink(mediaId, { ...native, number }, 3, { destination: 'ara-ara' }),
      'https://yoru.test',
    );
    assert.equal(url.pathname, `/ara-ara/read/${mediaId}/${number === 'Extra' ? '1' : number}`);
    assert.equal(url.searchParams.get('chapter'), chapterId);
    assert.equal(url.searchParams.get('source'), sourceRef.id);
    assert.equal(url.searchParams.get('language'), 'es');
    assert.equal(url.searchParams.get('page'), '3');
  }
  assert.equal(
    model.readerLink('mal-manga-1', { id: 'manifest:test', number: '1.5' }),
    '/read/mal-manga-1/1.5?chapter=manifest%3Atest',
  );
});

test('both integration paths remain selectable without moving the current page', () => {
  const current = { chapter: native, page: 7 };
  const core = { id: 'mangadex', mediaId: 'mal-manga-1', integration: 'core', name: 'MangaDex' };
  const extension = { id: sourceRef.id, mediaId, sourceRef, integration: 'suwayomi' };
  assert.equal(typeof model.readerSourceChoices, 'function');
  for (const integrationMode of ['all', 'core', 'extensions']) {
    const pinned = integrationMode === 'extensions' ? core : extension;
    const result = model.readerSourceChoices(
      [core, extension],
      { ...context, integrationMode },
      pinned,
    );
    assert.deepEqual(
      result.map((s) => s.id),
      ['mangadex', 'suwayomi:42'],
    );
    assert.deepEqual(current, { chapter: native, page: 7 });
  }
  const disabled = model.readerSourceChoices([core, extension], {
    ...context,
    overrides: { MangaDex: { yoru: false } },
  });
  assert.deepEqual(disabled, []);
});

test('generic chapter requests use explicit DTO identity and preserve the whole context', async (t) => {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (path, options) => {
    calls.push({ url: new URL(path, 'https://yoru.test'), options });
    return Response.json({
      ...native,
      pages: [],
      items: [{ ...native, pages: 5 }],
      sources: [{ id: sourceRef.id, sourceRef }],
      state: 'ready',
    });
  });
  await chapterList(
    mediaId,
    { source: sourceRef.id, sourceRef, language: 'es', page: 2 },
    context,
    true,
  );
  await readerChapter(mediaId, native, true, context);
  await readingSources(mediaId, true, context);
  assert.equal(calls.length, 3);
  for (const { url, options } of calls) {
    assert.equal(url.searchParams.get('destination'), 'yoru');
    assert.equal(url.searchParams.get('integration'), 'all');
    assert.equal(url.searchParams.get('selectionFingerprint'), context.selectionFingerprint);
    assert.ok(options.signal);
  }
  assert.equal(calls[0].url.searchParams.get('page'), '2');
  assert.ok(calls[1].url.pathname.endsWith(`/reader/${chapterId}`));
});

test('disabled and failing sources never restore unrelated pages', async (t) => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    calls++;
    return Response.json({ error: 'Selected source is offline.' }, { status: 503 });
  });
  const disabled = { ...context, overrides: { MangaDex: { yoru: false } } };
  const listing = await chapterList(mediaId, { source: sourceRef.id, sourceRef }, disabled, true);
  assert.equal(listing.state, 'disabled');
  await assert.rejects(readerChapter(mediaId, native, true, disabled), /disabled/i);
  assert.equal(calls, 0);
  await assert.rejects(readerChapter(mediaId, native, true, context), /offline/);
  assert.equal(calls, 1);
});

test('an unresolved identity chapter wrapper omits credentials and personal votes', async (t) => {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (path, options) => {
    calls.push(options);
    return Response.json({ items: [{ ...native, stats: { views: 10, myRating: 5 } }] });
  });
  const unknown = {
    ...context,
    owner: null,
    scope: null,
    selectionFingerprint: 'unknown-reader-wrapper',
  };
  const result = await chapterList(mediaId, { source: sourceRef.id, sourceRef }, unknown, true);
  assert.equal(calls[0].credentials, 'omit');
  assert.equal(result.items[0].stats.myRating, 0);
  assert.equal(result.items[0].stats.views, 10);
});

test('a verified core alternative accepts its legacy manifest without native source metadata', async (t) => {
  const chapter = {
    id: 'sw-weebcentral-1-2',
    sourceRef: {
      id: 'weebcentral',
      integration: 'core',
      providerKey: 'Weeb Central',
      language: 'en',
    },
  };
  t.mock.method(globalThis, 'fetch', async () =>
    Response.json({
      id: chapter.id,
      mediaId: 'mal-manga-21',
      source: 'weebcentral',
      number: '3.5',
      pages: [],
    }),
  );
  const result = await readerChapter('mal-manga-21', chapter, true, context);
  assert.equal(result.id, chapter.id);
  await assert.rejects(
    readerChapter(
      'mal-manga-21',
      { ...chapter, sourceRef: { ...chapter.sourceRef, id: 'mangadex' } },
      true,
      context,
    ),
    /different.*source/,
  );
});

test('unready, expired and cancelled reader contexts cannot start upstream work', async (t) => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    calls++;
    return Response.json({ pages: [] });
  });
  await assert.rejects(readerChapter(mediaId, native, true, null), /context|ready|selection/i);
  await assert.rejects(
    readerChapter(mediaId, native, true, { ...context, expiresAt: 1 }),
    /expired|context|ready/i,
  );
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    readerChapter(mediaId, native, true, { ...context, signal: controller.signal }),
    /abort/i,
  );
  assert.equal(calls, 0);
});

test('manifest pages and generic hover warmup keep source, destination, fingerprint and cancellation', async (t) => {
  const calls = [],
    images = [];
  const oldLocation = globalThis.location,
    oldImage = globalThis.Image;
  globalThis.location = { origin: 'https://yoru.test' };
  globalThis.Image = class {
    set src(value) {
      if (value) {
        images.push(value);
        queueMicrotask(() => this.onload?.());
      }
    }
  };
  t.after(() => {
    globalThis.location = oldLocation;
    globalThis.Image = oldImage;
  });
  t.mock.method(globalThis, 'fetch', async (path) => {
    calls.push(path);
    return Response.json(
      path.includes('/reader/')
        ? {
            ...native,
            pages: [0, 1, 2].map((i) => ({
              url: `/api/media/${mediaId}/reader/${chapterId}/page/${i}`,
            })),
          }
        : { media: { id: mediaId, sourceRef } },
    );
  });
  const ara = {
    ...context,
    destination: 'ara-ara',
    overrides: { MangaDex: { 'ara-ara': true } },
    selectionFingerprint: 'ara-preload',
  };
  const href = model.readerLink(mediaId, native, 2, { destination: 'ara-ara' });
  await warmReaderLink(href, undefined, 1, null);
  assert.equal(calls.length, 0);
  await warmReaderLink(href, new AbortController().signal, 1, ara);
  assert.equal(calls.length, 2);
  assert.equal(images.length, 1);
  const image = new URL(images[0], 'https://yoru.test');
  assert.ok(image.pathname.endsWith('/page/1'));
  assert.equal(image.searchParams.get('destination'), 'ara-ara');
  assert.equal(image.searchParams.get('selectionFingerprint'), 'ara-preload');
  assert.equal(image.searchParams.get('integration'), 'all');
  await warmReaderLink(href, undefined, 1, { ...ara, expiresAt: 1 });
  assert.equal(calls.length, 2);
});

test('a late manifest from an aborted owner cannot restore any pages', async (t) => {
  let resolve;
  t.mock.method(
    globalThis,
    'fetch',
    () =>
      new Promise((finish) => {
        resolve = finish;
      }),
  );
  const controller = new AbortController();
  const pending = readerChapter(mediaId, native, true, {
    ...context,
    owner: 'old-owner',
    scope: 'old-owner',
    signal: controller.signal,
  });
  controller.abort();
  resolve(
    Response.json({
      ...native,
      pages: [{ url: `/api/media/${mediaId}/reader/${chapterId}/page/0` }],
    }),
  );
  await assert.rejects(pending, /abort/i);
});
