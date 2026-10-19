import assert from 'node:assert/strict';
import { test } from 'node:test';
test('extension gateway uses fixed routes, bounded assets and redacted failures', async () => {
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
