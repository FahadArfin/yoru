import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EventEmitter } from 'node:events';
import { bridgeHandler } from '../services/reader-bridge/server.mjs';

test('authenticated health checks identify this bridge without touching providers', async () => {
  const handle = bridgeHandler({ key: 'x'.repeat(32), instanceId: 'this-bridge', provider: {} });
  const unauthorized = await handle(new Request('http://bridge/health'));
  assert.equal(unauthorized.status, 401);
  const response = await handle(
    new Request('http://bridge/health', {
      headers: { authorization: `Bearer ${'x'.repeat(32)}` },
    }),
  );
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, instanceId: 'this-bridge' });
  assert.equal(response.headers.get('cache-control'), 'no-store');
});

async function fixture() {
  const { superviseTunnel } = await import('../services/reader-bridge/tunnel.mjs');
  let time = 0,
    healthy = true,
    registrationOk = true;
  const children = [],
    registrations = [],
    timers = [];
  const supervisor = superviseTunnel({
    key: 'x'.repeat(32),
    instanceId: 'this-bridge',
    origin: 'https://yoru.example',
    now: () => time,
    log: () => {},
    every: () => 0,
    cancelEvery: () => {},
    later: (fn, ms) => {
      const timer = { fn, ms };
      timers.push(timer);
      return timer;
    },
    cancelLater: (timer) => {
      if (timer) timer.cancelled = true;
    },
    spawnImpl: () => {
      const child = new EventEmitter();
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.kills = [];
      child.kill = (signal) => {
        child.kills.push(signal);
        return true;
      };
      children.push(child);
      return child;
    },
    fetchImpl: async (url, options) => {
      assert.equal(options.redirect, 'error');
      if (url.endsWith('/health')) {
        if (!healthy) throw new Error('DNS ENOTFOUND');
        return Response.json({
          ok: true,
          instanceId: healthy === 'wrong' ? 'another-bridge' : 'this-bridge',
        });
      }
      registrations.push(JSON.parse(options.body).url);
      return new Response('', { status: registrationOk ? 200 : 503 });
    },
  });
  const announce = (child, host = 'first') =>
    child.stderr.emit(
      'data',
      `Your quick Tunnel has been created\n| https://${host}.trycloudflare.com |\nRegistered tunnel connection`,
    );
  return {
    supervisor,
    children,
    timers,
    registrations,
    announce,
    setTime: (value) => {
      time = value;
    },
    setHealthy: (value) => {
      healthy = value;
    },
    setRegistration: (value) => {
      registrationOk = value;
    },
  };
}

test('dead DNS is replaced after three failures and the replacement is registered', async () => {
  const f = await fixture();
  f.announce(f.children[0]);
  await f.supervisor.check();
  assert.equal(f.registrations.length, 1);
  f.setTime(180000);
  f.setHealthy(false);
  await f.supervisor.check();
  await f.supervisor.check();
  assert.equal(f.children[0].kills.length, 0);
  await f.supervisor.check();
  assert.deepEqual(f.children[0].kills, ['SIGTERM']);
  assert.equal(f.registrations.length, 1, 'dead addresses must not renew');
  f.children[0].emit('exit', 0);
  const retry = f.timers.find((t) => !t.cancelled && t.ms === 10000);
  retry.fn();
  f.announce(f.children[1], 'replacement');
  f.setHealthy(true);
  await f.supervisor.check();
  assert.equal(f.registrations.at(-1), 'https://replacement.trycloudflare.com');
  f.supervisor.stop();
});

test('transient failures reset on success and website outages do not rotate healthy tunnels', async () => {
  const f = await fixture();
  f.announce(f.children[0]);
  f.setTime(180000);
  for (let i = 0; i < 4; i++) {
    f.setHealthy(false);
    await f.supervisor.check();
    await f.supervisor.check();
    f.setHealthy(true);
    f.setRegistration(false);
    await f.supervisor.check();
  }
  assert.equal(f.children[0].kills.length, 0);
  f.supervisor.stop();
});

test('wrong bridge identity fails health and a stuck child is force stopped', async () => {
  const f = await fixture();
  f.announce(f.children[0]);
  f.setTime(180000);
  f.setHealthy('wrong');
  await f.supervisor.check();
  await f.supervisor.check();
  await f.supervisor.check();
  assert.deepEqual(f.children[0].kills, ['SIGTERM']);
  f.timers.find((t) => !t.cancelled && t.ms === 5000).fn();
  assert.deepEqual(f.children[0].kills, ['SIGTERM', 'SIGKILL']);
  assert.equal(f.registrations.length, 0);
  f.supervisor.stop();
});

test('startup stalls recover and shutdown prevents respawning', async () => {
  const f = await fixture();
  f.setTime(90000);
  await f.supervisor.check();
  assert.equal(f.children[0].kills.length, 0);
  f.setTime(135000);
  await f.supervisor.check();
  assert.deepEqual(f.children[0].kills, ['SIGTERM']);
  f.supervisor.stop();
  f.children[0].emit('exit', 0);
  assert.equal(f.timers.filter((t) => !t.cancelled).length, 0);
});
