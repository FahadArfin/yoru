import assert from 'node:assert/strict';
import { test } from 'node:test';
import express from 'express';
test('Node public reader normalization preserves only safe actionable gateway status metadata and retry headers', async () => {
  const { readerErrorMiddleware, readerErrorResponse } = await import('../server/reader-errors.js');
  const { createExtensionGateway } = await import('../server/extension-gateway.js');
  let status = 429,
    retry = '60';
  const gateway = createExtensionGateway({
    bridgeKey: 'test-reader-key-more-than-thirty-two-characters',
    bridgeUrl: 'https://fixture.trycloudflare.com',
    extensionsEnabled: true,
    fetchImpl: async () =>
      new Response('PRIVATE Bearer https://private.trycloudflare.com', {
        status,
        headers: { 'retry-after': retry },
      }),
  });
  const app = express();
  app.get('/reader', async (_req, res, next) => {
    try {
      res.json(
        await gateway.details({ sourceId: 'suwayomi:123', upstreamKey: '/a', language: 'en' }),
      );
    } catch (error) {
      next(error);
    }
  });
  app.use(readerErrorMiddleware);
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  try {
    for (const [code, reason] of [
      [401, 'auth-required'],
      [403, 'access-challenge'],
      [429, 'rate-limited'],
    ]) {
      status = code;
      const response = await fetch(`http://127.0.0.1:${server.address().port}/reader`),
        body = await response.json();
      assert.equal(response.status, code);
      assert.equal(response.headers.get('retry-after'), '60');
      assert.equal(response.headers.get('cache-control'), 'no-store');
      assert.equal(body.reason, reason);
      assert.equal(body.retryAfter, '60');
      assert.ok(Number.isFinite(Date.parse(body.retryAt)));
      assert.doesNotMatch(JSON.stringify(body), /PRIVATE|Bearer|trycloudflare/);
    }
    retry = 'https://private.trycloudflare.com';
    const response = await fetch(`http://127.0.0.1:${server.address().port}/reader`);
    assert.equal(response.headers.get('retry-after'), null);
    assert.equal((await response.json()).retryAt, undefined);
    assert.equal(
      readerErrorResponse(Object.assign(new Error('PRIVATE'), { status: 429, retryAfter: '60' })),
      null,
      'untrusted errors are not promoted to public reader failures',
    );
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
