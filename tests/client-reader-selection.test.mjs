import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createReaderSelection } from '../src/reader/selection.js';
import { readerRequest, syncGuestReaderContext, readingCacheScope, api } from '../src/api.js';
const defaults = () => ({ overrides: {}, modes: { yoru: 'all', 'ara-ara': 'all' } });
const defer = () => {
  let resolve;
  const promise = new Promise((r) => {
    resolve = r;
  });
  return { promise, resolve };
};

test('reader selection waits for current guest revision and isolates accounts', async () => {
  const guest = defer(),
    a = defer(),
    b = defer();
  const controller = createReaderSelection({
    loadSettings: async (scope) => ({ ...defaults(), revision: scope === 'b' ? 2 : 99 }),
    syncGuest: () => guest.promise,
    readContext: (destination, signal, scope) => (scope === 'a' ? a : b).promise,
    saveMode: async () => {},
  });
  const pending = controller.select({ scope: 'guest', destination: 'yoru', enabled: true });
  assert.equal(controller.getSnapshot().ready, false);
  guest.resolve({ destination: 'yoru', revision: 7, selectionFingerprint: 'guest-seven' });
  await pending;
  assert.equal(controller.getSnapshot().context.selectionFingerprint, 'guest-seven');
  const oldA = controller.select({ scope: 'a', destination: 'yoru', enabled: true });
  await Promise.resolve();
  const newB = controller.select({ scope: 'b', destination: 'ara-ara', enabled: true });
  await Promise.resolve();
  b.resolve({ destination: 'ara-ara', revision: 2, selectionFingerprint: 'b-two' });
  await newB;
  a.resolve({ destination: 'yoru', revision: 99, selectionFingerprint: 'a-late' });
  await oldA;
  assert.equal(controller.getSnapshot().context.owner, 'b');
  assert.equal(controller.getSnapshot().context.selectionFingerprint, 'b-two');
  assert.deepEqual(controller.getSnapshot().context.modes, defaults().modes);
  await controller.select({ scope: 'b', destination: 'ara-ara', enabled: false });
  assert.equal(controller.getSnapshot().ready, false);
  assert.equal(controller.getSnapshot().context, null);
});

test('guest context CAS is serialized per destination and conflicts refetch without replay', async () => {
  const original = globalThis.fetch;
  const posts = [],
    gate = defer();
  let revision = 0,
    reads = 0,
    active = 0,
    maxActive = 0,
    conflict = false;
  globalThis.fetch = async (_url, options) => {
    if (options.method !== 'POST') {
      reads++;
      return Response.json({
        destination: 'yoru',
        revision,
        selectionFingerprint: `f-${revision}`,
      });
    }
    active++;
    maxActive = Math.max(active, maxActive);
    const body = JSON.parse(options.body);
    posts.push(body);
    if (posts.length === 1) await gate.promise;
    active--;
    if (conflict) {
      revision++;
      return Response.json({ error: 'Concurrent change' }, { status: 409 });
    }
    assert.equal(body.expectedRevision, revision);
    return Response.json({
      destination: 'yoru',
      revision: ++revision,
      selectionFingerprint: `f-${revision}`,
    });
  };
  try {
    const first = syncGuestReaderContext('yoru', defaults());
    const second = syncGuestReaderContext('yoru', {
      ...defaults(),
      modes: { yoru: 'core', 'ara-ara': 'all' },
    });
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(posts.length, 1);
    gate.resolve();
    await Promise.all([first, second]);
    assert.equal(maxActive, 1);
    assert.equal(posts[1].expectedRevision, 1);
    conflict = true;
    const beforeReads = reads;
    await assert.rejects(
      syncGuestReaderContext('yoru', defaults()),
      (e) => e.status === 409 && e.concurrentChange === true && e.context.revision === 3,
    );
    assert.equal(posts.length, 3);
    assert.equal(reads, beforeReads + 2);
  } finally {
    globalThis.fetch = original;
  }
});

test('reader requests require a ready selection, partition cache and redact unresolved identity', async () => {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(url);
    return Response.json({ items: [{ stats: { myRating: 5, views: 9 } }] });
  };
  try {
    await assert.rejects(
      readerRequest('/api/reader/discovery', { destination: 'yoru', scope: 'guest' }),
      /selection/i,
    );
    assert.equal(calls.length, 0);
    const context = {
      destination: 'ara-ara',
      integrationMode: 'extensions',
      scope: null,
      selectionFingerprint: 'ready',
    };
    const result = await readerRequest('/api/reader/discovery?q=x', context);
    assert.equal(result.items[0].stats.myRating, 0);
    assert.equal(result.items[0].stats.views, 9);
    assert.match(calls[0], /destination=ara-ara/);
    assert.match(calls[0], /integration=extensions/);
    assert.notEqual(
      readingCacheScope({ owner: 'a', ...context }),
      readingCacheScope({ owner: 'b', ...context }),
    );
    assert.notEqual(
      readingCacheScope({ owner: 'a', ...context }),
      readingCacheScope({ owner: 'a', ...context, destination: 'yoru' }),
    );
  } finally {
    globalThis.fetch = original;
  }
});

test('reader API retains public failure metadata without treating provider authentication as logout', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () =>
    Response.json(
      {
        error: 'Provider sign-in required',
        reason: 'auth-required',
        retryAfter: 30,
        retryAt: 12345,
        restartRequired: true,
      },
      { status: 401 },
    );
  try {
    await assert.rejects(
      api('/api/reader/discovery'),
      (e) =>
        e.status === 401 &&
        e.reason === 'auth-required' &&
        e.retryAfter === 30 &&
        e.retryAt === 12345 &&
        e.restartRequired === true,
    );
  } finally {
    globalThis.fetch = original;
  }
});

test('unchanged selection refresh keeps prepared metadata usable without invalidation', async () => {
  const refreshGate = defer();
  let refreshing = false;
  const controller = createReaderSelection({
    loadSettings: async () => defaults(),
    saveMode: async () => {},
    syncGuest: () =>
      refreshing
        ? refreshGate.promise
        : Promise.resolve({ destination: 'yoru', revision: 1, selectionFingerprint: 'stable' }),
  });
  await controller.select({ scope: 'guest', destination: 'yoru', enabled: true });
  const context = controller.getSnapshot().context;
  refreshing = true;
  const refresh = controller.refresh();
  await Promise.resolve();
  assert.equal(controller.getSnapshot().ready, true);
  assert.equal(controller.getSnapshot().context, context);
  refreshGate.resolve({ destination: 'yoru', revision: 1, selectionFingerprint: 'stable' });
  await refresh;
  assert.equal(controller.getSnapshot().context, context);
});

test('a conflict cancels already queued guest projections instead of replaying them', async () => {
  const original = globalThis.fetch,
    gate = defer();
  let posts = 0;
  globalThis.fetch = async (_url, options) => {
    if (options.method !== 'POST')
      return Response.json({ destination: 'ara-ara', revision: 3, selectionFingerprint: 'remote' });
    posts++;
    await gate.promise;
    return Response.json({ error: 'Changed' }, { status: 409 });
  };
  try {
    const first = syncGuestReaderContext('ara-ara', defaults());
    const queued = syncGuestReaderContext('ara-ara', {
      ...defaults(),
      modes: { yoru: 'all', 'ara-ara': 'core' },
    });
    const firstRejected = assert.rejects(first, (e) => e.concurrentChange === true);
    const queuedRejected = assert.rejects(queued, (e) => e.concurrentChange === true);
    gate.resolve();
    await Promise.all([firstRejected, queuedRejected]);
    assert.equal(posts, 1);
  } finally {
    globalThis.fetch = original;
  }
});

test('the selected page or cover is not requested until its guest cookie context syncs', async () => {
  const original = globalThis.fetch,
    gate = defer();
  const fetched = [],
    requests = [];
  globalThis.fetch = async (url) => {
    fetched.push(url);
    return Response.json({ pages: [] });
  };
  const controller = createReaderSelection({
    loadSettings: async () => defaults(),
    saveMode: async () => {},
    syncGuest: () => gate.promise,
  });
  const unsubscribe = controller.subscribe(() => {
    const { context, ready } = controller.getSnapshot();
    if (ready)
      requests.push(
        readerRequest('/api/reader/media/ext-manga-00000000000000000000000000000001', context),
      );
  });
  try {
    const selection = controller.select({ scope: 'guest', destination: 'ara-ara', enabled: true });
    await Promise.resolve();
    assert.deepEqual(fetched, []);
    gate.resolve({ destination: 'ara-ara', revision: 8, selectionFingerprint: 'revision-eight' });
    await selection;
    await Promise.all(requests);
    assert.equal(fetched.length, 1);
    assert.match(fetched[0], /selectionFingerprint=revision-eight/);
  } finally {
    unsubscribe();
    globalThis.fetch = original;
  }
});

test('guest cache reuse validates remote revision but does not rewrite unchanged selection', async () => {
  const original = globalThis.fetch;
  let revision = 30,
    posts = 0;
  globalThis.fetch = async (_url, options) => {
    if (options.method === 'POST') {
      posts++;
      revision++;
    }
    return Response.json({
      destination: 'yoru',
      revision,
      selectionFingerprint: `same-${revision}`,
    });
  };
  try {
    await syncGuestReaderContext('yoru', defaults());
    await syncGuestReaderContext('yoru', defaults());
    assert.equal(posts, 1);
  } finally {
    globalThis.fetch = original;
  }
});

test('unresolved identity reads public defaults without account cookies or guest preference writes', async () => {
  let writes = 0,
    settingsReads = 0,
    contextOwner;
  const controller = createReaderSelection({
    loadSettings: async () => {
      settingsReads++;
      return { ...defaults(), modes: { yoru: 'core', 'ara-ara': 'core' } };
    },
    saveMode: async () => {},
    syncGuest: async () => {
      writes++;
      return { destination: 'yoru', revision: 1, selectionFingerprint: 'cookie-context' };
    },
    readContext: async (destination, _signal, owner) => {
      contextOwner = owner;
      return { destination, revision: 0, selectionFingerprint: 'public-default' };
    },
  });
  await controller.select({ scope: null, destination: 'yoru', enabled: true });
  assert.equal(writes, 0);
  assert.equal(settingsReads, 0);
  assert.equal(contextOwner, null);
  assert.equal(controller.getSnapshot().context.integrationMode, 'all');
  const original = globalThis.fetch;
  let credentials;
  globalThis.fetch = async (_url, options) => {
    credentials = options.credentials;
    return Response.json({ myRating: 5 });
  };
  try {
    assert.equal(
      (await readerRequest('/api/reader/discovery', controller.getSnapshot().context)).myRating,
      0,
    );
    assert.equal(credentials, 'omit');
  } finally {
    globalThis.fetch = original;
  }
});

test('an account context revision cannot be paired with an older settings projection', async () => {
  const controller = createReaderSelection({
    loadSettings: async () => ({ ...defaults(), revision: 1 }),
    saveMode: async () => {},
    readContext: async () => ({ destination: 'yoru', revision: 2, selectionFingerprint: 'newer' }),
  });
  await controller.select({
    scope: 'account-current-revision',
    destination: 'yoru',
    enabled: true,
  });
  assert.equal(controller.getSnapshot().ready, false);
  assert.equal(controller.getSnapshot().context, null);
  assert.match(controller.getSnapshot().error, /changed in another tab/);
});

test('changing a mode persists through the shared setter and a scoped completion cannot change another owner', async () => {
  const saveGate = defer(),
    saves = [];
  const snapshots = new Map([
    ['one', { ...defaults(), revision: 1 }],
    ['two', { ...defaults(), revision: 1 }],
  ]);
  const controller = createReaderSelection({
    loadSettings: async (scope) => snapshots.get(scope),
    saveMode: async (...args) => {
      saves.push(args);
      await saveGate.promise;
    },
    readContext: async (destination, _signal, scope) => ({
      destination,
      revision: 1,
      selectionFingerprint: `${scope}-one`,
    }),
  });
  await controller.select({ scope: 'one', destination: 'yoru', enabled: true });
  const save = controller.setIntegrationMode('extensions', 'ara-ara');
  await controller.select({ scope: 'two', destination: 'yoru', enabled: true });
  saveGate.resolve();
  await save;
  assert.deepEqual(saves, [['one', 'ara-ara', 'extensions']]);
  assert.equal(controller.getSnapshot().context.owner, 'two');
  assert.equal(controller.getSnapshot().context.modes['ara-ara'], 'all');
});

test('a remounted reader request does not reuse an aborted in-flight request', async () => {
  const original = globalThis.fetch,
    firstResponse = defer();
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    if (calls === 1) return firstResponse.promise;
    return Response.json({ title: 'Current response' });
  };
  const context = {
    destination: 'yoru',
    integrationMode: 'all',
    scope: 'strict-mode-owner',
    selectionFingerprint: 'strict-mode-selection',
  };
  const oldController = new AbortController();
  try {
    const old = readerRequest('/api/reader/media/mal-manga-21?remount=1', {
      ...context,
      signal: oldController.signal,
    });
    const oldRejected = assert.rejects(old, { name: 'AbortError' });
    oldController.abort();
    const fresh = readerRequest('/api/reader/media/mal-manga-21?remount=1', {
      ...context,
      signal: new AbortController().signal,
    });
    await Promise.resolve();
    assert.equal(calls, 2);
    firstResponse.resolve(Response.json({ title: 'Discarded response' }));
    await oldRejected;
    assert.equal((await fresh).title, 'Current response');
  } finally {
    firstResponse.resolve(Response.json({ title: 'cleanup' }));
    globalThis.fetch = original;
  }
});

test('an expired guest lease hides context and cannot remain ready until cookie sync completes', async () => {
  let now = 1000;
  const gate = defer();
  let renewing = false;
  const controller = createReaderSelection({
    now: () => now,
    loadSettings: async () => defaults(),
    saveMode: async () => {},
    syncGuest: () =>
      renewing
        ? gate.promise
        : Promise.resolve({
            destination: 'yoru',
            revision: 1,
            selectionFingerprint: 'leased',
            expiresAt: 2000,
          }),
  });
  await controller.select({ scope: 'guest', destination: 'yoru', enabled: true });
  assert.equal(controller.getSnapshot().ready, true);
  now = 2001;
  assert.equal(controller.getSnapshot().ready, false);
  assert.equal(controller.getSnapshot().context, null);
  renewing = true;
  const refresh = controller.refresh();
  await Promise.resolve();
  assert.equal(controller.getSnapshot().ready, false);
  gate.resolve({
    destination: 'yoru',
    revision: 2,
    selectionFingerprint: 'renewed',
    expiresAt: 5000,
  });
  await refresh;
  assert.equal(controller.getSnapshot().ready, true);
  assert.equal(controller.getSnapshot().context.revision, 2);
  controller.dispose();
});

test('guest lease renewal is anchored to POST and matching GET cannot extend an old lease', async () => {
  const originalFetch = globalThis.fetch,
    originalNow = Date.now;
  let now = 29 * 60000,
    revision = 500,
    posts = 0;
  Date.now = () => now;
  globalThis.fetch = async (_url, options) => {
    if (options.method === 'POST') {
      posts++;
      revision++;
    }
    return Response.json({
      destination: 'ara-ara',
      revision,
      selectionFingerprint: `lease-${revision}`,
    });
  };
  try {
    const first = await syncGuestReaderContext('ara-ara', defaults());
    assert.equal(posts, 1, 'a matching old server row is renewed when no known POST lease exists');
    assert.equal(first.expiresAt, now + 25 * 60000);
    now += 23 * 60000;
    const validated = await syncGuestReaderContext('ara-ara', defaults());
    assert.equal(posts, 1);
    assert.equal(
      validated.expiresAt,
      first.expiresAt,
      'GET validation must not extend the POST lease',
    );
    now += 90000;
    const renewed = await syncGuestReaderContext('ara-ara', defaults());
    assert.equal(posts, 2, 'renew the context in the last minute before the local lease expires');
    assert.equal(renewed.expiresAt, now + 25 * 60000);
    now = renewed.expiresAt + 1;
    let network = 0;
    globalThis.fetch = async () => {
      network++;
      return Response.json({});
    };
    await assert.rejects(
      readerRequest('/api/reader/discovery', {
        ...renewed,
        scope: 'guest',
        integrationMode: 'all',
      }),
      /expired/i,
    );
    assert.equal(network, 0);
  } finally {
    Date.now = originalNow;
    globalThis.fetch = originalFetch;
  }
});

test('aborting an active hover request does not cancel an active navigation request with its own signal', async () => {
  const original = globalThis.fetch,
    responses = [];
  globalThis.fetch = (_url, options) =>
    new Promise((resolve, reject) => {
      responses.push(resolve);
      options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true });
    });
  const context = {
    destination: 'yoru',
    integrationMode: 'all',
    scope: 'active-callers-owner',
    selectionFingerprint: 'independent-active-callers',
  };
  const hover = new AbortController(),
    navigation = new AbortController();
  try {
    const preload = readerRequest('/api/reader/media/mal-manga-21?active=1', {
      ...context,
      signal: hover.signal,
    });
    const preloadRejected = assert.rejects(preload, { name: 'AbortError' });
    const reading = readerRequest('/api/reader/media/mal-manga-21?active=1', {
      ...context,
      signal: navigation.signal,
    });
    void reading.catch(() => {});
    assert.equal(responses.length, 2);
    hover.abort();
    responses[1](Response.json({ title: 'Navigation stays alive' }));
    await preloadRejected;
    assert.equal((await reading).title, 'Navigation stays alive');
  } finally {
    hover.abort();
    navigation.abort();
    for (const resolve of responses) resolve(Response.json({ title: 'cleanup' }));
    globalThis.fetch = original;
  }
});

test('an already aborted reader caller performs zero network requests', async () => {
  const original = globalThis.fetch;
  let requests = 0;
  globalThis.fetch = async () => {
    requests++;
    return Response.json({ title: 'must not fetch' });
  };
  const controller = new AbortController();
  controller.abort();
  try {
    await assert.rejects(
      readerRequest('/api/reader/media/mal-manga-21', {
        destination: 'yoru',
        integrationMode: 'all',
        scope: 'already-aborted',
        selectionFingerprint: 'already-aborted-selection',
        signal: controller.signal,
      }),
      { name: 'AbortError' },
    );
    assert.equal(requests, 0);
  } finally {
    globalThis.fetch = original;
  }
});

test('an aborted guest caller waits for its dispatched CAS before the next queued mutation', async () => {
  const original = globalThis.fetch,
    gate = defer();
  let revision = 800,
    posts = 0;
  globalThis.fetch = async (_url, options) => {
    if (options.method !== 'POST')
      return Response.json({
        destination: 'yoru',
        revision,
        selectionFingerprint: `mutation-${revision}`,
      });
    posts++;
    const body = JSON.parse(options.body);
    if (posts === 1)
      return new Promise((resolve, reject) => {
        options.signal?.addEventListener('abort', () => reject(options.signal.reason), {
          once: true,
        });
        gate.promise.then(() => {
          revision++;
          resolve(
            Response.json({
              destination: 'yoru',
              revision,
              selectionFingerprint: `mutation-${revision}`,
            }),
          );
        });
      });
    assert.equal(body.expectedRevision, revision);
    return Response.json({
      destination: 'yoru',
      revision: ++revision,
      selectionFingerprint: `mutation-${revision}`,
    });
  };
  const caller = new AbortController();
  let first, second;
  try {
    first = syncGuestReaderContext('yoru', defaults(), caller.signal);
    const aborted = assert.rejects(first, { name: 'AbortError' });
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(posts, 1);
    caller.abort();
    second = syncGuestReaderContext('yoru', {
      ...defaults(),
      modes: { yoru: 'extensions', 'ara-ara': 'all' },
    });
    void second.catch(() => {});
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(posts, 1, 'the old server CAS is still running even though its caller aborted');
    gate.resolve();
    await aborted;
    assert.equal((await second).revision, 802);
  } finally {
    gate.resolve();
    await Promise.allSettled([first, second].filter(Boolean));
    globalThis.fetch = original;
  }
});

test('guest context admission is bounded and a released queue admits new work', async () => {
  const original = globalThis.fetch,
    gate = defer();
  let revision = 900;
  globalThis.fetch = async (_url, options) => {
    if (options.method === 'POST') {
      await gate.promise;
      revision++;
    }
    return Response.json({
      destination: 'ara-ara',
      revision,
      selectionFingerprint: `bounded-${revision}`,
    });
  };
  const pending = [];
  try {
    for (let i = 0; i < 16; i++) pending.push(syncGuestReaderContext('ara-ara', defaults()));
    await assert.rejects(
      syncGuestReaderContext('ara-ara', defaults()),
      (e) => e.status === 503 && e.reason === 'busy',
    );
    gate.resolve();
    await Promise.all(pending);
    assert.equal((await syncGuestReaderContext('ara-ara', defaults())).revision, 901);
  } finally {
    gate.resolve();
    await Promise.allSettled(pending);
    globalThis.fetch = original;
  }
});

test('an expired queued guest job drops before another context GET or POST', async () => {
  const originalFetch = globalThis.fetch,
    originalNow = Date.now,
    gate = defer();
  let now = 100000,
    revision = 950,
    reads = 0;
  Date.now = () => now;
  globalThis.fetch = async (_url, options) => {
    if (options.method === 'POST') {
      await gate.promise;
      revision++;
    } else reads++;
    return Response.json({
      destination: 'yoru',
      revision,
      selectionFingerprint: `deadline-${revision}`,
    });
  };
  const first = syncGuestReaderContext('yoru', defaults());
  const queued = syncGuestReaderContext('yoru', defaults());
  const expired = assert.rejects(queued, { name: 'TimeoutError' });
  try {
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(reads, 1);
    now += 60001;
    gate.resolve();
    await first;
    await expired;
    assert.equal(reads, 1);
  } finally {
    gate.resolve();
    await Promise.allSettled([first, queued]);
    Date.now = originalNow;
    globalThis.fetch = originalFetch;
  }
});

test('a dispatched CAS timeout drops captured queued projections before another GET', async () => {
  const originalFetch = globalThis.fetch,
    originalTimeout = AbortSignal.timeout;
  const deadline = new AbortController();
  let signals = 0,
    revision = 1000,
    reads = 0,
    posts = 0;
  AbortSignal.timeout = () => (++signals === 2 ? deadline.signal : new AbortController().signal);
  globalThis.fetch = async (_url, options) => {
    if (options.method !== 'POST') {
      reads++;
      return Response.json({
        destination: 'ara-ara',
        revision,
        selectionFingerprint: `uncertain-${revision}`,
      });
    }
    posts++;
    if (posts === 1)
      return new Promise((_resolve, reject) =>
        options.signal.addEventListener('abort', () => reject(options.signal.reason), {
          once: true,
        }),
      );
    assert.equal(JSON.parse(options.body).expectedRevision, revision);
    return Response.json({
      destination: 'ara-ara',
      revision: ++revision,
      selectionFingerprint: `uncertain-${revision}`,
    });
  };
  const first = syncGuestReaderContext('ara-ara', defaults());
  const queued = syncGuestReaderContext('ara-ara', {
    ...defaults(),
    modes: { yoru: 'all', 'ara-ara': 'extensions' },
  });
  const failed = assert.rejects(
    first,
    (e) => e.name === 'TimeoutError' && e.concurrentChange === true,
  );
  const dropped = assert.rejects(queued, (e) => e.status === 409 && e.concurrentChange === true);
  try {
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(posts, 1);
    deadline.abort(new DOMException('Timed out', 'TimeoutError'));
    await failed;
    await dropped;
    assert.equal(reads, 1);
    assert.equal(posts, 1);
    AbortSignal.timeout = originalTimeout;
    revision = 1001; // The server's old commit may finish after its response deadline.
    const explicit = await syncGuestReaderContext('ara-ara', {
      ...defaults(),
      modes: { yoru: 'all', 'ara-ara': 'core' },
    });
    assert.equal(explicit.revision, 1002);
    assert.equal(reads, 2);
    assert.equal(posts, 2);
  } finally {
    deadline.abort(new DOMException('cleanup', 'TimeoutError'));
    await Promise.allSettled([first, queued, failed, dropped]);
    AbortSignal.timeout = originalTimeout;
    globalThis.fetch = originalFetch;
  }
});

test('a failed conflict reconciliation cannot permit passive guest projection replay', async () => {
  const originalFetch = globalThis.fetch;
  for (const failure of ['http', 'network', 'timeout']) {
    let posts = 0,
      reads = 0;
    let settings = defaults();
    globalThis.fetch = async (_url, options) => {
      if (options.method === 'POST') {
        posts++;
        if (posts === 1) return Response.json({ error: 'Concurrent choice' }, { status: 409 });
      } else {
        reads++;
        if (reads === 2) {
          if (failure === 'network') throw new TypeError('Network failed');
          if (failure === 'timeout') throw new DOMException('Timed out', 'TimeoutError');
          return Response.json({ error: 'Reconciliation unavailable' }, { status: 503 });
        }
      }
      return Response.json({
        destination: 'yoru',
        revision: 4000 + posts,
        selectionFingerprint: `reconcile-${failure}-${posts}`,
      });
    };
    const controller = createReaderSelection({
      loadSettings: async () => settings,
      saveMode: async (_scope, destination, mode) => {
        settings = { ...settings, modes: { ...settings.modes, [destination]: mode } };
      },
      syncGuest: syncGuestReaderContext,
      readContext: (destination, signal) =>
        api(`/api/reader/context?destination=${destination}`, { signal }),
    });
    try {
      await controller.select({ scope: 'guest', destination: 'yoru', enabled: true });
      assert.equal(posts, 1);
      assert.equal(controller.getSnapshot().ready, false);
      await controller.refresh();
      assert.equal(posts, 1, `${failure} reconciliation failure must retain the conflict barrier`);
      assert.equal(controller.getSnapshot().ready, false);
      assert.match(controller.getSnapshot().error, /changed/);
      assert.equal(reads, 3, 'passive refresh may inspect the latest context without POST');
      await controller.setIntegrationMode('core');
      assert.equal(posts, 2, 'a fresh explicit choice may recover through fresh GET/CAS');
      assert.equal(controller.getSnapshot().ready, true);
    } finally {
      controller.dispose();
      globalThis.fetch = originalFetch;
    }
  }
});

test('passive guest refresh after conflict or uncertain timeout reads without replay until an explicit destination action', async () => {
  const originalFetch = globalThis.fetch;
  for (const failure of ['conflict', 'timeout']) {
    let clock = Date.now(),
      posts = 0,
      reads = 0,
      rejected = false;
    let settings = defaults();
    const destination = failure === 'conflict' ? 'yoru' : 'ara-ara';
    globalThis.fetch = async (_url, options) => {
      if (options.method === 'POST') {
        posts++;
        if (!rejected) {
          rejected = true;
          return Response.json(
            { error: 'Concurrent context' },
            { status: failure === 'conflict' ? 409 : 504 },
          );
        }
      } else reads++;
      return Response.json({
        destination:
          new URL(_url, 'https://yoru.test').searchParams.get('destination') ||
          JSON.parse(options.body).destination,
        revision: 2000 + posts,
        selectionFingerprint: `barrier-${failure}-${posts}`,
      });
    };
    const controller = createReaderSelection({
      now: () => clock,
      loadSettings: async () => settings,
      saveMode: async (_scope, target, mode) => {
        settings = { ...settings, modes: { ...settings.modes, [target]: mode } };
      },
      syncGuest: syncGuestReaderContext,
      readContext: (target, signal) => api(`/api/reader/context?destination=${target}`, { signal }),
    });
    try {
      await controller.select({ scope: 'guest', destination, enabled: true });
      assert.equal(controller.getSnapshot().ready, false);
      assert.equal(posts, 1);
      clock += 30000; // The hook's passive interval calls this exact controller entrypoint.
      const before = reads;
      await controller.refresh();
      assert.equal(reads, before + 1);
      assert.equal(posts, 1, 'passive refresh must never replay the failed desired projection');
      assert.match(controller.getSnapshot().error, /changed|sync/i);
      const other = destination === 'yoru' ? 'ara-ara' : 'yoru';
      await controller.select({ scope: 'guest', destination: other, enabled: true });
      assert.equal(
        controller.getSnapshot().ready,
        true,
        'the other destination remains independently usable',
      );
      assert.equal(posts, 2);
      await controller.select({ scope: 'guest', destination, enabled: true });
      assert.equal(posts, 2, 'switching back cannot clear the destination barrier');
      await controller.setIntegrationMode('core', destination);
      assert.equal(posts, 3);
      assert.equal(controller.getSnapshot().ready, true);
      assert.equal(controller.getSnapshot().context.integrationMode, 'core');
    } finally {
      controller.dispose();
      globalThis.fetch = originalFetch;
    }
  }
  globalThis.fetch = originalFetch;
});

test('real preference publish starts one CAS per explicit action and reset clears both destination barriers', async () => {
  const originalFetch = globalThis.fetch,
    originalWindow = globalThis.window,
    originalStorage = globalThis.localStorage;
  const events = new EventTarget(),
    storage = new Map(),
    pending = [];
  globalThis.window = events;
  globalThis.localStorage = {
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, value),
  };
  const {
    READER_SELECTION_ACTION_EVENT,
    CATALOG_PREFERENCES_EVENT,
    loadReaderSettings,
    saveIntegrationMode,
    saveCatalogPreference,
    resetCatalogPreferences,
  } = await import('../src/reader/catalog-preferences.js');
  let posts = 0,
    revision = 3000,
    fail = true,
    compatibilityEvents = 0;
  globalThis.fetch = async (_url, options) => {
    const target =
      options.method === 'POST'
        ? JSON.parse(options.body).destination
        : new URL(_url, 'https://yoru.test').searchParams.get('destination');
    if (options.method === 'POST') {
      posts++;
      if (fail) {
        fail = false;
        return Response.json({ error: 'Changed' }, { status: 409 });
      }
      revision++;
    }
    return Response.json({
      destination: target,
      revision,
      selectionFingerprint: `published-${revision}`,
    });
  };
  const controller = createReaderSelection({
    loadSettings: loadReaderSettings,
    saveMode: saveIntegrationMode,
    syncGuest: syncGuestReaderContext,
    readContext: (target, signal) => api(`/api/reader/context?destination=${target}`, { signal }),
  });
  const action = (event) => {
    if (event.detail.scope === 'guest')
      pending.push(controller.preferencesChanged(event.detail.destination));
  };
  events.addEventListener(READER_SELECTION_ACTION_EVENT, action);
  events.addEventListener(CATALOG_PREFERENCES_EVENT, (event) => {
    assert.equal(event.detail, 'guest');
    compatibilityEvents++;
  });
  try {
    await controller.select({ scope: 'guest', destination: 'yoru', enabled: true });
    assert.equal(posts, 1);
    await controller.setIntegrationMode('core');
    await Promise.all(pending.splice(0));
    assert.equal(posts, 2, 'setter plus published action must dispatch exactly one CAS');
    assert.equal(controller.getSnapshot().ready, true);
    fail = true;
    await controller.select({ scope: 'guest', destination: 'ara-ara', enabled: true });
    assert.equal(posts, 3);
    await saveCatalogPreference('guest', 'MangaDex', 'yoru', false);
    await Promise.all(pending.splice(0));
    assert.equal(
      posts,
      3,
      'another destination action must not clear the blocked current destination',
    );
    assert.equal(controller.getSnapshot().ready, false);
    await resetCatalogPreferences('guest');
    await Promise.all(pending.splice(0));
    assert.equal(posts, 4, 'reset explicitly clears both barriers and dispatches once');
    assert.equal(controller.getSnapshot().ready, true);
    assert.deepEqual(controller.getSnapshot().context.modes, defaults().modes);
    assert.equal(compatibilityEvents, 3, 'existing event payload and listeners remain valid');
  } finally {
    controller.dispose();
    globalThis.fetch = originalFetch;
    globalThis.window = originalWindow;
    globalThis.localStorage = originalStorage;
  }
});
