import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  createProbeTransport,
  probeExtension,
  probeInventory,
} from '../scripts/reader-release-probe.mjs';

const sourceId = 'suwayomi:-9223372036854775808';
function fixture({ rating = 'safe', feedState = 'ready', changedEdition = false } = {}) {
  const calls = [];
  const titleRef = { sourceId, language: 'en', upstreamKey: '/private-title' };
  const editionRef = { title: titleRef, upstreamKey: '/private-edition' };
  let pages = 0;
  return {
    calls,
    call: async (path, body) => {
      calls.push({ path, body });
      if (path.endsWith('/browse'))
        return {
          items: [
            { upstreamRef: titleRef, classification: { rating }, metadata: { title: 'PRIVATE' } },
          ],
          sourceState: { state: feedState },
          hasMore: true,
        };
      if (path.endsWith('/details'))
        return {
          upstreamRef: titleRef,
          classification: { rating },
          metadata: { title: 'PRIVATE' },
        };
      if (path.endsWith('/chapters')) return { items: [{ upstreamRef: editionRef }] };
      if (path.endsWith('/reader'))
        return { edition: { upstreamRef: changedEdition ? {} : editionRef }, pages: [0, 1] };
      if (path.endsWith('/page'))
        return {
          mime: 'image/png',
          bytes: 4,
          sha256: 'a'.repeat(64),
          cache: pages++ ? 'hit' : 'miss',
        };
      throw new Error('Unexpected fixture request');
    },
  };
}

test('release probe retains signed64 identity and bounds acquisition without disclosing content', async () => {
  const f = fixture();
  const result = await probeExtension(f.call, { sourceId });
  assert.equal(result.operations.length, 6);
  assert.equal(
    result.operations.every((row) => row.status === 'tested'),
    true,
  );
  assert.equal(f.calls.filter((c) => c.path.endsWith('/browse')).length, 1);
  assert.deepEqual(
    f.calls.filter((c) => c.path.endsWith('/page')).map((c) => c.body.page),
    [0, 0],
  );
  const output = JSON.stringify(result);
  for (const secret of ['PRIVATE', '/private-title', '/private-edition'])
    assert.equal(output.includes(secret), false);
});

test('denied and unsupported feeds stop before details or images', async () => {
  for (const feedState of ['unsupported', 'unavailable', 'stale']) {
    const f = fixture({ feedState });
    const result = await probeExtension(f.call, { sourceId });
    assert.equal(f.calls.length, 1);
    assert.equal(
      result.operations[0].status,
      feedState === 'unsupported' ? 'unsupported' : 'unavailable',
    );
  }
});

test('adult confirmation and safe classification gate image acquisition', async () => {
  for (const destination of ['yoru', 'ara-ara']) {
    const f = fixture({ rating: 'adult' });
    const result = await probeExtension(f.call, { sourceId, destination });
    assert.equal(f.calls.length, 1);
    assert.equal(result.operations.at(-1).status, 'unavailable');
  }
  const f = fixture({ rating: 'adult' });
  const result = await probeExtension(f.call, {
    sourceId,
    destination: 'ara-ara',
    suitableAdultMaterialConfirmed: true,
  });
  assert.equal(result.operations.at(-1).operation, 'page-repeat');
});

test('changed exact edition stops before bytes', async () => {
  const f = fixture({ changedEdition: true });
  const result = await probeExtension(f.call, { sourceId });
  assert.equal(result.operations.at(-1).reason, 'identity-mismatch');
  assert.equal(
    f.calls.some((c) => c.path.endsWith('/page')),
    false,
  );
});

test('transport never follows challenges or leaks upstream response text', async () => {
  let seen;
  const call = createProbeTransport({
    base: 'http://127.0.0.1:4568',
    key: 'PRIVATE',
    fetchImpl: async (url, options) => {
      seen = options;
      return new Response('PRIVATE https://private.invalid/', { status: 403 });
    },
  });
  await assert.rejects(
    call('/extension/browse', {}),
    (error) =>
      error.reason === 'access-denied-stop' &&
      error.status === 403 &&
      !error.message.includes('PRIVATE'),
  );
  assert.equal(seen.redirect, 'manual');
  await assert.rejects(call('https://foreign.invalid/'), /foreign-endpoint/);
});

test('inventory reports declarations without promoting runtime support and stops at four pages', async () => {
  let calls = 0;
  const result = await probeInventory(async () => {
    calls++;
    return {
      sources: [
        {
          id: sourceId,
          language: 'en',
          classification: { rating: 'safe' },
          capabilities: { latest: 'unsupported', popular: 'supported' },
        },
      ],
      nextCursor: 'continue',
    };
  });
  assert.equal(calls, 4);
  assert.equal(result.complete, false);
  assert.equal(result.sources[0].capabilities.latest, 'unsupported');
  assert.equal(result.sources[0].capabilities.popular, 'unverified');
});
