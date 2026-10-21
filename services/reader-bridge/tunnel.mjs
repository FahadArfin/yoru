import { spawn } from 'node:child_process';

export function tunnelAddress(output) {
  if (!output.includes('Your quick Tunnel has been created')) return '';
  return output.match(/\|\s+(https:\/\/[a-z0-9-]+\.trycloudflare\.com)\s+\|/)?.[1] || '';
}

// Supervise the public route, not upstream manga providers. A live cloudflared
// process can retain a dead Quick Tunnel DNS name indefinitely.
export function superviseTunnel({
  key,
  instanceId,
  origin,
  fetchImpl = fetch,
  spawnImpl = spawn,
  now = Date.now,
  log = console.log,
  every = setInterval,
  cancelEvery = clearInterval,
  later = setTimeout,
  cancelLater = clearTimeout,
}) {
  let current,
    retryTimer,
    interval,
    pending,
    stopped = false,
    retryDelay = 10000;
  const shutdown = new AbortController();
  const signal = () => AbortSignal.any([shutdown.signal, AbortSignal.timeout(10000)]);
  const schedule = (fn, ms) => {
    const timer = later(fn, ms);
    timer?.unref?.();
    return timer;
  };

  function restart(state) {
    if (stopped || current !== state || state.restarting) return;
    state.restarting = true;
    state.address = '';
    log('Reader tunnel health failed; reconnecting automatically.');
    state.child.kill('SIGTERM');
    state.killTimer = schedule(() => {
      if (current === state) state.child.kill('SIGKILL');
    }, 5000);
  }

  async function runCheck() {
    const state = current;
    if (stopped || !state || state.restarting) return;
    if (!state.address) {
      if (now() - state.startedAt >= 120000) restart(state);
      return;
    }
    const address = state.address;
    try {
      const response = await fetchImpl(`${address}/health`, {
        headers: { authorization: `Bearer ${key}` },
        cache: 'no-store',
        redirect: 'error',
        signal: signal(),
      });
      if (!response.ok) {
        await response.body?.cancel();
        throw new Error('Unhealthy');
      }
      const reader = response.body?.getReader();
      if (!reader) throw new Error('Empty health response');
      let text = '',
        length = 0;
      const decoder = new TextDecoder();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          length += value.byteLength;
          if (length > 1024) throw new Error('Invalid health response');
          text += decoder.decode(value, { stream: true });
        }
        text += decoder.decode();
      } finally {
        await reader.cancel().catch(() => {});
      }
      const data = JSON.parse(text);
      if (data.ok !== true || data.instanceId !== instanceId) throw new Error('Wrong bridge');
    } catch {
      if (!stopped && current === state && !state.restarting) {
        state.failures++;
        log(`Reader tunnel health pending (${state.failures}/3).`);
        if (state.failures >= 3 && now() - state.startedAt >= 120000) restart(state);
      }
      return;
    }
    if (stopped || current !== state || state.restarting) return;
    state.failures = 0;
    retryDelay = 10000;
    try {
      const response = await fetchImpl(`${origin}/api/reader-bridge/register`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${key}`,
          origin,
        },
        body: JSON.stringify({ url: address }),
        redirect: 'error',
        signal: signal(),
      });
      await response.body?.cancel();
      if (!stopped && current === state)
        log(
          response.ok
            ? 'Reader connection renewed.'
            : `Reader connection pending (${response.status}).`,
        );
    } catch {
      if (!stopped) log('Reader connection pending.');
    }
  }

  function check() {
    if (!pending)
      pending = Promise.resolve()
        .then(runCheck)
        .finally(() => {
          pending = null;
        });
    return pending;
  }

  function launch() {
    if (stopped) return;
    const state = { address: '', failures: 0, startedAt: now(), restarting: false };
    current = state;
    let finished = false;
    const exited = () => {
      if (finished) return;
      finished = true;
      cancelLater(state.killTimer);
      if (current !== state) return;
      current = null;
      if (stopped) return;
      log('Reader tunnel stopped; reconnecting automatically.');
      retryTimer = schedule(launch, retryDelay);
      retryDelay = Math.min(retryDelay * 2, 60000);
    };
    try {
      state.child = spawnImpl(
        'cloudflared',
        ['tunnel', '--no-autoupdate', '--url', 'http://127.0.0.1:3000'],
        { stdio: ['ignore', 'pipe', 'pipe'] },
      );
    } catch {
      exited();
      return;
    }
    let output = '',
      candidate = '';
    const receive = (chunk) => {
      if (stopped || current !== state || state.restarting) return;
      output = (output + chunk.toString()).slice(-12000);
      candidate ||= tunnelAddress(output);
      if (candidate && !state.address && output.includes('Registered tunnel connection')) {
        state.address = candidate;
        log('Secure reader tunnel established; checking public connection.');
        void check();
      }
    };
    state.child.stdout.on('data', receive);
    state.child.stderr.on('data', receive);
    state.child.once('error', exited);
    state.child.once('exit', exited);
  }
  launch();
  interval = every(() => {
    void check();
  }, 45000);
  interval?.unref?.();
  return {
    check,
    stop() {
      stopped = true;
      shutdown.abort();
      cancelEvery(interval);
      cancelLater(retryTimer);
      cancelLater(current?.killTimer);
      current?.child?.kill('SIGTERM');
    },
  };
}
