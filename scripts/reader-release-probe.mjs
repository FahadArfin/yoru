// Operator-only acceptance helper. Never imported by either application runtime.
// Read private configuration with Node --env-file; never pass keys in arguments.
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { decimalSourceId } from '../services/reader-bridge/suwayomi-operations.mjs';

const digest = (value) => createHash('sha256').update(value).digest('hex');
const imageTypes = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/avif']);
const fail = (reason, status = 0) => Object.assign(new Error(reason), { reason, status });
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const state = (value) =>
  ['ready', 'empty', 'stale', 'unsupported', 'unavailable'].includes(value) ? value : 'unverified';

export function createProbeTransport({ base, key, fetchImpl = fetch }) {
  const origin = new URL(base);
  if (!['http:', 'https:'].includes(origin.protocol) || origin.username || origin.password)
    throw fail('invalid-endpoint');
  return async (path, payload, binary = false) => {
    const target = new URL(path, origin);
    if (target.origin !== origin.origin || !path.startsWith('/')) throw fail('foreign-endpoint');
    let response;
    try {
      response = await fetchImpl(target, {
        method: payload === undefined ? 'GET' : 'POST',
        headers: {
          ...(payload === undefined ? {} : { 'content-type': 'application/json' }),
          ...(key ? { authorization: `Bearer ${key}` } : {}),
        },
        ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
        redirect: 'manual',
        signal: AbortSignal.timeout(12000),
      });
    } catch {
      throw fail('transport-unavailable');
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw fail(
        [401, 403, 429].includes(response.status) ? 'access-denied-stop' : 'http-unavailable',
        response.status,
      );
    }
    const type = response.headers.get('content-type')?.split(';')[0];
    const limit = binary ? 20 * 1024 ** 2 : 4 * 1024 ** 2;
    if (binary && !imageTypes.has(type)) {
      await response.body?.cancel();
      throw fail('unexpected-content-type');
    }
    const chunks = [];
    let size = 0;
    const reader = response.body.getReader();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > limit) throw fail('response-too-large');
        chunks.push(value);
      }
    } finally {
      await reader.cancel().catch(() => {});
    }
    const bytes = Buffer.concat(chunks);
    if (binary)
      return {
        mime: type,
        bytes: size,
        sha256: digest(bytes),
        cache: response.headers.get('x-yoru-cache') === 'hit' ? 'hit' : 'miss',
      };
    try {
      return JSON.parse(bytes.toString());
    } catch {
      throw fail('invalid-json');
    }
  };
}

export async function probeInventory(call) {
  const sources = [];
  let cursor = null;
  // Installed metadata only. This never requests a provider feed or image.
  for (let page = 0; page < 4; page++) {
    const result = await call('/extension/catalogs', { cursor, limit: 100 });
    for (const source of result.sources || []) {
      if (!source.id?.startsWith('suwayomi:') || !decimalSourceId(source.id.slice(9))) continue;
      sources.push({
        sourceId: source.id,
        language: source.language,
        classification: source.classification?.rating,
        capabilities: Object.fromEntries(
          ['popular', 'latest', 'search', 'details', 'chapters', 'pages', 'resolveLink'].map(
            (op) => [
              op,
              source.capabilities?.[op] === 'unsupported' ? 'unsupported' : 'unverified',
            ],
          ),
        ),
      });
    }
    cursor = result.nextCursor;
    if (!cursor) break;
  }
  return { kind: 'declarations-only', sources, complete: !cursor };
}

export async function probeExtension(call, options) {
  const { sourceId, mode = 'popular', destination = 'yoru', selectedIndex = 0 } = options;
  if (
    !sourceId?.startsWith('suwayomi:') ||
    !decimalSourceId(sourceId.slice(9)) ||
    !['popular', 'latest'].includes(mode) ||
    !['yoru', 'ara-ara'].includes(destination) ||
    !Number.isInteger(selectedIndex) ||
    selectedIndex < 0
  )
    throw fail('invalid-probe-selection');
  const evidence = { sourceId, mode, destination, operations: [] };
  let operation = 'browse';
  const record = (name, extra = {}) =>
    evidence.operations.push({ operation: name, status: 'tested', ...extra });
  try {
    // Exactly one remote feed page, one selected title, one chapter and page zero twice.
    const feed = await call('/extension/browse', { sourceId, mode, page: 1 });
    const feedState = state(feed.sourceState?.state);
    if (['unsupported', 'unavailable', 'stale'].includes(feedState)) {
      evidence.operations.push({
        operation,
        status: feedState === 'unsupported' ? 'unsupported' : 'unavailable',
        reason: feedState,
      });
      return evidence;
    }
    record(operation, {
      feedState,
      count: feed.items?.length || 0,
      hasMore: feed.hasMore === true,
    });
    const title = feed.items?.[selectedIndex];
    if (!title) throw fail('no-selected-title');
    if (destination === 'ara-ara' && options.suitableAdultMaterialConfirmed !== true)
      throw fail('suitable-material-not-confirmed');
    if (destination === 'yoru' && title.classification?.rating !== 'safe')
      throw fail('selected-title-not-safe');
    const titleRef = title.upstreamRef;
    if (titleRef?.sourceId !== sourceId) throw fail('identity-mismatch');
    evidence.titleIdentityHash = digest(JSON.stringify(titleRef));
    operation = 'details';
    const detail = await call('/extension/details', { titleRef });
    if (!same(detail.upstreamRef, titleRef)) throw fail('identity-mismatch');
    if (destination === 'yoru' && detail.classification?.rating !== 'safe')
      throw fail('selected-title-not-safe');
    record(operation);
    operation = 'chapters';
    const chapters = await call('/extension/chapters', { titleRef, filters: {} });
    record(operation, { count: chapters.items?.length || 0 });
    const editionRef = chapters.items?.[0]?.upstreamRef;
    if (!editionRef || !same(editionRef.title, titleRef)) throw fail('no-exact-edition');
    evidence.editionIdentityHash = digest(JSON.stringify(editionRef));
    operation = 'reader';
    const manifest = await call('/extension/reader', { titleRef, editionRef });
    if (!same(manifest.edition?.upstreamRef, editionRef)) throw fail('identity-mismatch');
    const pageCount = manifest.pages?.length;
    if (!Number.isInteger(pageCount) || pageCount < 1 || pageCount > 500)
      throw fail('invalid-page-count');
    record(operation, { pageCount });
    operation = 'page';
    const page = await call('/extension/page', { titleRef, editionRef, page: 0 }, true);
    record(operation, page);
    operation = 'page-repeat';
    const repeat = await call('/extension/page', { titleRef, editionRef, page: 0 }, true);
    if (repeat.sha256 !== page.sha256 || repeat.cache !== 'hit')
      throw fail('cache-repeat-not-proven');
    record(operation, repeat);
  } catch (error) {
    evidence.operations.push({
      operation,
      status: 'unavailable',
      reason: error.reason || 'probe-failed',
      httpStatus: Number(error.status) || 0,
    });
  }
  return evidence;
}

async function main() {
  if (process.env.READER_RELEASE_PROBE !== '1') throw fail('live-probe-not-enabled');
  // Input is an operator-created selection only, never credentials or provider content.
  let input = '';
  for await (const chunk of process.stdin) {
    input += chunk;
    if (input.length > 4096) throw fail('input-too-large');
  }
  const options = JSON.parse(input);
  const key = process.env.READER_BRIDGE_KEY;
  if (!key || key.length < 32) throw fail('private-key-unavailable');
  const call = createProbeTransport({ base: 'http://127.0.0.1:4568', key });
  const result =
    options.operation === 'inventory'
      ? await probeInventory(call)
      : await probeExtension(call, options);
  console.log(JSON.stringify({ checkedAt: new Date().toISOString(), ...result }, null, 2));
  if (result.operations?.some((row) => row.status === 'unavailable')) process.exitCode = 2;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  main().catch((error) => {
    console.log(
      JSON.stringify({ status: 'unavailable', reason: error.reason || 'invalid-probe-input' }),
    );
    process.exitCode = 1;
  });
