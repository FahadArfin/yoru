import assert from 'node:assert/strict';
import { test } from 'node:test';
test('extension gateway uses fixed routes and redacts private failures', async () => {
  const { createExtensionGateway } = await import('../server/extension-gateway.js');
  let calls = 0,
    failure = false;
  const options = {
    bridgeKey: 'test-reader-key-more-than-thirty-two-characters',
    bridgeUrl: 'https://fixture.trycloudflare.com',
    extensionsEnabled: true,
    fetchImpl: async (url, init) => {
      calls++;
      assert.equal(new URL(url).pathname, '/extension/details');
      assert.equal(init.redirect, 'manual');
      assert.deepEqual(JSON.parse(init.body), {
        titleRef: { sourceId: 'suwayomi:123', upstreamKey: '/title/a', language: 'en' },
      });
      if (failure) throw new Error('PRIVATE_TUNNEL_SECRET');
      return Response.json({ metadata: { title: 'A' } });
    },
  };
  const ref = { sourceId: 'suwayomi:123', upstreamKey: '/title/a', language: 'en' };
  assert.equal((await createExtensionGateway(options).details(ref)).metadata.title, 'A');
  await assert.rejects(
    createExtensionGateway({ ...options, extensionsEnabled: false }).details(ref),
    { status: 404 },
  );
  assert.throws(
    () => createExtensionGateway(options).details({ ...ref, sourceId: 'http://attacker.test' }),
    { status: 400 },
  );
  assert.equal(calls, 1);
  failure = true;
  await assert.rejects(
    createExtensionGateway(options).details(ref),
    (e) => e.status === 503 && !e.message.includes('PRIVATE'),
  );
});

const ref = { sourceId: 'suwayomi:123', upstreamKey: '/title/a', language: 'en' };
const gatewayOptions = {
  bridgeKey: 'test-reader-key-more-than-thirty-two-characters',
  bridgeUrl: 'https://fixture.trycloudflare.com',
  extensionsEnabled: true,
};
const now = Date.parse('2026-10-19T00:00:00Z');
for (const [status, reason] of [
  [401, 'auth-required'],
  [403, 'access-challenge'],
  [429, 'rate-limited'],
])
  test(`extension gateway preserves safe ${status} status reason and bounded retry guidance`, async () => {
    const { createExtensionGateway } = await import('../server/extension-gateway.js');
    await assert.rejects(
      createExtensionGateway({
        ...gatewayOptions,
        now: () => now,
        fetchImpl: async () =>
          new Response('Bearer PRIVATE https://private.trycloudflare.com', {
            status,
            headers: { 'retry-after': '60' },
          }),
      }).details(ref),
      (error) => {
        assert.equal(error.status, status);
        assert.equal(error.reason, reason);
        assert.equal(error.retryAfter, '60');
        assert.equal(error.retryAt, '2026-10-19T00:01:00.000Z');
        assert.doesNotMatch(error.message, /PRIVATE|trycloudflare|Bearer/);
        return true;
      },
    );
  });
test('extension gateway validates HTTP-date and rejects malformed past or excessive Retry-After values', async () => {
  const { createExtensionGateway } = await import('../server/extension-gateway.js');
  for (const retry of [
    new Date(now + 90000).toUTCString(),
    ...[
      '-1',
      '1.5',
      '1e3',
      '86401',
      '99999999999999',
      'x'.repeat(101),
      'not-a-date',
      'https://private.trycloudflare.com',
      new Date(now - 1000).toUTCString(),
      new Date(now + 86401000).toUTCString(),
    ],
  ]) {
    await assert.rejects(
      createExtensionGateway({
        ...gatewayOptions,
        now: () => now,
        fetchImpl: async () =>
          new Response(null, { status: 429, headers: { 'retry-after': retry } }),
      }).details(ref),
      (error) => {
        assert.equal(error.status, 429);
        assert.equal(error.reason, 'rate-limited');
        if (retry === new Date(now + 90000).toUTCString()) {
          assert.equal(error.retryAfter, retry);
          assert.equal(error.retryAt, '2026-10-19T00:01:30.000Z');
        } else {
          assert.equal(error.retryAfter, undefined);
          assert.equal(error.retryAt, undefined);
        }
        return true;
      },
    );
  }
});
test('extension gateway enforces actual streamed JSON image byte and MIME limits', async () => {
  const { createExtensionGateway } = await import('../server/extension-gateway.js');
  const streamed = (size, type) =>
    new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(new Uint8Array(size));
          controller.close();
        },
      }),
      { headers: { 'content-type': type } },
    );
  const make = (response) =>
    createExtensionGateway({ ...gatewayOptions, fetchImpl: async () => response });
  await assert.rejects(make(streamed(4 * 1024 ** 2 + 1, 'application/json')).details(ref), {
    status: 502,
  });
  await assert.rejects(make(streamed(20 * 1024 ** 2 + 1, 'image/png')).cover(ref), { status: 502 });
  await assert.rejects(make(streamed(4, 'text/html')).cover(ref), { status: 502 });
  assert.equal(
    (await make(streamed(20 * 1024 ** 2, 'image/png')).cover(ref)).body.byteLength,
    20 * 1024 ** 2,
  );
  const json = JSON.stringify({ text: 'x'.repeat(4 * 1024 ** 2 - 11) });
  assert.equal(new TextEncoder().encode(json).byteLength, 4 * 1024 ** 2);
  assert.equal((await make(new Response(json)).details(ref)).text.length, 4 * 1024 ** 2 - 11);
});
