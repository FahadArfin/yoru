import { validateReaderSource } from './external-catalog-store.js';
import { apiError } from './validation.js';
import { withinReaderDeadline } from './reader-operation.js';

export const INVENTORY_FRESH_MS = 60000;
export async function refreshReaderSources(
  context,
  deps,
  {
    deadlineAt = (deps.now || Date.now)() + 12000,
    maxOperations = 4,
    cursor = null,
    limit = 100,
  } = {},
) {
  const now = deps.now || Date.now,
    currentSources = [],
    sourceStates = [];
  let nextCursor = cursor,
    complete = false,
    failure;
  if (!context.extensionsEnabled)
    return { currentSources, sourceIds: [], complete: true, sourceStates, nextCursor: null };
  const visited = new Set();
  try {
    for (let n = 0; n < Math.min(4, maxOperations) && now() < deadlineAt; n++) {
      if (visited.has(nextCursor)) throw apiError(502, 'Invalid catalog continuation.');
      visited.add(nextCursor);
      const result = await withinReaderDeadline(
        { signal: context.signal, deadlineAt, priority: 'discovery' },
        (op) => deps.bridge.catalogs({ cursor: nextCursor, limit: Math.min(100, limit) }, op),
        now,
      );
      if (
        !Array.isArray(result.sources) ||
        result.sources.length > Math.min(100, limit) ||
        (result.nextCursor != null &&
          (typeof result.nextCursor !== 'string' || Buffer.byteLength(result.nextCursor) > 2048))
      )
        throw apiError(502, 'Invalid catalog inventory.');
      for (const source of result.sources) {
        validateReaderSource(source);
      }
      // Inventory is request-local policy evidence. Permanent source identities are
      // written only when titles use them; one cache write covers an inventory page.
      await deps.db.run(
        `INSERT INTO reader_inventory_cache(source_id,payload,observed_at)
        SELECT json_extract(value,'$.id'),value,? FROM json_each(?) WHERE true
        ON CONFLICT(source_id) DO UPDATE SET payload=excluded.payload,observed_at=excluded.observed_at`,
        now(),
        JSON.stringify(result.sources),
      );
      currentSources.push(...result.sources);
      nextCursor = result.nextCursor || null;
      if (!nextCursor) {
        complete = true;
        break;
      }
    }
  } catch (error) {
    failure = error;
    // A failed refresh never makes last-known-safe inventory fresh.
    await deps.db.run('DELETE FROM reader_inventory_cache');
    sourceStates.push({
      sourceId: null,
      state: 'unavailable',
      status: error.status || 503,
      retryAt: error.retryAt || null,
      operation: 'catalogs',
      reason: error.reason || 'offline',
    });
  }
  return {
    currentSources,
    sourceIds: currentSources.map((s) => s.id),
    complete,
    sourceStates,
    nextCursor,
    failure,
  };
}
