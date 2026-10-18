import assert from 'node:assert/strict';
import { test } from 'node:test';

test('bridge registration requires its server secret and rejects local or arbitrary URLs', async () => {
  const { registerReaderBridge, readerBridge } = await import('../server/reading-sources.js');
  let saved;
  const options = {
    bridgeKey: 'a-test-key-that-is-at-least-32-characters',
    now: () => 1000,
    save: async (k, v) => {
      saved = v;
    },
    load: async () => saved,
  };
  await assert.rejects(
    registerReaderBridge('wrong', { url: 'https://reader.trycloudflare.com' }, options),
    { status: 401 },
  );
  await assert.rejects(
    registerReaderBridge(options.bridgeKey, { url: 'http://127.0.0.1' }, options),
    { status: 400 },
  );
  await assert.rejects(
    registerReaderBridge(options.bridgeKey, { url: 'https://evil.test' }, options),
    { status: 400 },
  );
  await registerReaderBridge(
    options.bridgeKey,
    { url: 'https://reader.trycloudflare.com' },
    options,
  );
  assert.equal((await readerBridge(options)).url, 'https://reader.trycloudflare.com');
  assert.equal(await readerBridge({ ...options, now: () => 999999 }), null);
});

test('reader rejects anime and rejects a returned chapter from another title before exposing pages', async () => {
  const { getReaderChapter } = await import('../server/reading-sources.js');
  const options = {
    bridgeKey: 'a-test-key-that-is-at-least-32-characters',
    bridgeUrl: 'https://reader.trycloudflare.com',
    media: async (id) => ({ id, category: 'MANGA' }),
    fetchImpl: async () =>
      Response.json({
        mediaId: 'mal-manga-99',
        chapter: { id: 'sw-weebcentral-1-2', pages: ['/api/v1/manga/1/chapter/0/page/0'] },
      }),
  };
  await assert.rejects(getReaderChapter('mal-anime-1', 'sw-weebcentral-1-2', options), {
    status: 400,
  });
  await assert.rejects(getReaderChapter('mal-manga-21', 'sw-weebcentral-1-2', options), {
    status: 502,
  });
});
