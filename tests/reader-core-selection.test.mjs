import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Providers } from '../services/reader-bridge/providers.mjs';
import { bridgeHandler } from '../services/reader-bridge/server.mjs';
import { getReadingSources } from '../server/reading-sources.js';
const media = { id: 'mal-manga-21', category: 'MANGA', title: 'Death Note' };
const key = 'test-bridge-selection-key-more-than-32-characters';
for (const [name, context, expected, probes] of [
  [
    'disabled Weeb Central',
    { destination: 'yoru', integrationMode: 'all', overrides: { 'Weeb Central': { yoru: false } } },
    ['mangadex'],
    1,
  ],
  [
    'extensions-only discovery',
    { destination: 'yoru', integrationMode: 'extensions', overrides: {} },
    [],
    0,
  ],
  [
    'both core providers disabled',
    {
      destination: 'yoru',
      integrationMode: 'all',
      overrides: { MangaDex: { yoru: false }, 'Weeb Central': { yoru: false } },
    },
    [],
    0,
  ],
])
  test(`core source selection excludes ${name} before actual Providers matching`, async () => {
    const directory = await mkdtemp(join(tmpdir(), 'yoru-core-selection-'));
    let swMatches = 0,
      upstream = 0,
      bridgeCalls = 0;
    const provider = new Providers({
      directory,
      client: {
        execute: async () => {
          upstream++;
          throw new Error('must not query Suwayomi');
        },
      },
      fetchImpl: async () => {
        upstream++;
        return new Response(null, { status: 404 });
      },
    });
    const original = provider.swMatch.bind(provider);
    provider.swMatch = (...args) => {
      swMatches++;
      return original(...args);
    };
    const handler = bridgeHandler({ key, provider });
    try {
      const result = await getReadingSources(media.id, {
        context,
        media: async () => media,
        bridgeKey: key,
        bridgeUrl: 'https://fixture.trycloudflare.com',
        fetchImpl: async (url, init) => {
          bridgeCalls++;
          return handler(new Request(url, init));
        },
      });
      assert.deepEqual(
        result.sources.map((s) => s.id),
        expected,
      );
      assert.equal(swMatches, 0, 'disabled/excluded source must never enter swMatch');
      assert.equal(upstream, 0, 'neither matching metadata nor Suwayomi calls may run');
      assert.equal(bridgeCalls, probes);
      const send = (body) =>
        handler(
          new Request('https://fixture/sources', {
            method: 'POST',
            headers: { authorization: `Bearer ${key}` },
            body: JSON.stringify({ media, ...body }),
          }),
        );
      assert.equal((await send({ coreSources: [] })).status, 200);
      assert.equal(swMatches, 0);
      assert.equal((await send({ coreSources: ['unknown'] })).status, 400);
      assert.equal(swMatches, 0);
      assert.equal(
        (await send({})).status,
        200,
        'omitted selection retains legacy both-source behavior',
      );
      assert.equal(swMatches, 1);
      assert.equal(upstream, 1);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
