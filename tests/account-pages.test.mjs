import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAccountPager, accountPageUrl } from '../src/account-pages.js';

test('account client branches source and row cursors without unbounded requests or losing earlier rows', async () => {
  const calls = [],
    snapshots = [];
  const pager = createAccountPager({
    publish: (page) => snapshots.push(page),
    request: async (task) => {
      calls.push(task);
      if (!task.cursor && !task.sourceCursor)
        return {
          items: [],
          sourceCursor: 'sources-400',
          nextCursor: 'rows-5000',
          inventoryComplete: false,
          recordsComplete: false,
        };
      if (task.sourceCursor)
        return { items: [{ mediaId: 'first' }], inventoryComplete: true, recordsComplete: true };
      return { items: [{ mediaId: 'last' }], inventoryComplete: true, recordsComplete: true };
    },
  });
  await pager.refresh();
  assert.equal(calls.length, 1);
  assert.equal(snapshots.at(-1).incomplete, true);
  await pager.loadMore();
  assert.deepEqual(calls[1], { sourceCursor: 'sources-400' });
  await pager.loadMore();
  assert.deepEqual(calls[2], { cursor: 'rows-5000' });
  assert.deepEqual(
    snapshots.at(-1).items.map((item) => item.mediaId),
    ['first', 'last'],
  );
  assert.equal(snapshots.at(-1).incomplete, false);
  assert.equal(
    accountPageUrl('/api/resume', 'ara-ara', calls[1]),
    '/api/resume?destination=ara-ara&sourceCursor=sources-400',
  );
  pager.stop();
});

test('account client aborts replaced or exited scopes and cannot publish a stale continuation', async () => {
  let resolveOld, oldSignal;
  const snapshots = [];
  let calls = 0;
  const pager = createAccountPager({
    publish: (page) => snapshots.push(page),
    request: (task, signal) => {
      if (++calls === 1) {
        oldSignal = signal;
        return new Promise((resolve) => {
          resolveOld = resolve;
        });
      }
      return Promise.resolve({ items: [{ mediaId: 'current' }] });
    },
  });
  const old = pager.refresh();
  await pager.refresh();
  assert.equal(oldSignal.aborted, true);
  resolveOld({ items: [{ mediaId: 'wrong-owner' }], sourceCursor: 'stale' });
  await old;
  assert.deepEqual(snapshots.at(-1).items, [{ mediaId: 'current' }]);
  const count = snapshots.length;
  pager.stop();
  await pager.loadMore();
  assert.equal(snapshots.length, count);
});

test('settled account readiness survives deferred background refresh and failure while initial scopes still wait', async () => {
  let finish, fail;
  const snapshots = [];
  const pager = createAccountPager({
    publish: (page) => snapshots.push(page),
    request: () =>
      new Promise((resolve, reject) => {
        finish = resolve;
        fail = reject;
      }),
  });
  const initial = pager.refresh();
  assert.equal(snapshots.at(-1).ready, false, 'initial synchronization remains a mount gate');
  finish({ items: [{ mediaId: 'known' }] });
  await initial;
  const refresh = pager.refresh();
  assert.equal(snapshots.at(-1).loading, true);
  assert.equal(
    snapshots.at(-1).ready,
    true,
    'background refresh must not unmount settled consumers',
  );
  assert.deepEqual(
    snapshots.at(-1).items,
    [],
    'current authorization still clears during revalidation',
  );
  finish({ items: [{ mediaId: 'known' }] });
  await refresh;
  const failed = pager.refresh();
  fail(new Error('Unavailable'));
  await failed;
  assert.equal(snapshots.at(-1).ready, true);
  assert.equal(snapshots.at(-1).error, true);
  assert.deepEqual(snapshots.at(-1).items, []);
  pager.stop();
  const replacement = createAccountPager({
    publish: (page) => snapshots.push(page),
    request: () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  });
  const next = replacement.refresh();
  assert.equal(
    snapshots.at(-1).ready,
    false,
    'replacement owner/destination uses a fresh initial gate',
  );
  replacement.stop();
  finish({ items: [{ mediaId: 'other' }] });
  await next;
});
