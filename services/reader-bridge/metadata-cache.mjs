import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, rename, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';

const periods = { feed: [5 * 60000, 3600000], details: [3600000, 24 * 3600000] };
const abortError = () => new DOMException('Cancelled', 'AbortError');
const timeoutError = () => new DOMException('Operation deadline exceeded', 'TimeoutError');
export class MetadataCache {
  constructor(directory, { now = Date.now, maxBytes = 64 * 1024 ** 2, maxEntries = 5000 } = {}) {
    Object.assign(this, {
      directory,
      now,
      maxBytes: Math.min(maxBytes, 64 * 1024 ** 2),
      maxEntries: Math.min(maxEntries, 5000),
    });
    this.pending = new Map();
    this.generations = new Map();
    this.writes = Promise.resolve();
  }
  path(key) {
    return join(this.directory, createHash('sha256').update(key).digest('hex'));
  }
  async load(key) {
    try {
      return JSON.parse(await readFile(this.path(key), 'utf8'));
    } catch {
      return null;
    }
  }
  mutate(work) {
    const result = this.writes.then(work, work);
    this.writes = result.catch(() => {});
    return result;
  }
  async entries() {
    await mkdir(this.directory, { recursive: true });
    const files = await readdir(this.directory);
    const entries = [];
    for (const name of files) {
      if (!/^[a-f0-9]{64}$/.test(name)) continue;
      try {
        const text = await readFile(join(this.directory, name), 'utf8');
        const value = JSON.parse(text);
        entries.push({ name, value, bytes: Buffer.byteLength(text) });
      } catch {
        await rm(join(this.directory, name), { force: true });
      }
    }
    return entries;
  }
  async save(key, entry, generation) {
    return this.mutate(async () => {
      if ((this.generations.get(entry.sourceId) || 0) !== generation) return;
      const text = JSON.stringify(entry);
      if (Buffer.byteLength(text) > this.maxBytes) return;
      await mkdir(this.directory, { recursive: true });
      const temp = `${this.path(key)}.${randomUUID()}.tmp`;
      try {
        await writeFile(temp, text);
        await rename(temp, this.path(key));
      } finally {
        await rm(temp, { force: true });
      }
      const entries = (await this.entries()).sort((a, b) => a.value.fetchedAt - b.value.fetchedAt);
      let bytes = entries.reduce((sum, e) => sum + e.bytes, 0),
        count = entries.length;
      for (const old of entries) {
        const age = this.now() - old.value.fetchedAt;
        if (
          count <= this.maxEntries &&
          bytes <= this.maxBytes &&
          age <= (periods[old.value.kind]?.[1] || 0)
        )
          continue;
        await rm(join(this.directory, old.name), { force: true });
        bytes -= old.bytes;
        count--;
      }
    });
  }
  async invalidateSource(sourceId) {
    this.generations.set(sourceId, (this.generations.get(sourceId) || 0) + 1);
    for (const [key, task] of this.pending)
      if (task.sourceId === sourceId) {
        this.pending.delete(key);
        task.controller.abort();
      }
    await this.mutate(async () => {
      for (const entry of await this.entries())
        if (entry.value.sourceId === sourceId)
          await rm(join(this.directory, entry.name), { force: true });
    });
  }
  getOrFetch(key, { sourceId, kind }, loader, context = {}) {
    if (!periods[kind]) return Promise.reject(new Error('Unknown metadata cache kind.'));
    if (context.signal?.aborted) return Promise.reject(abortError());
    if (context.deadlineAt != null && context.deadlineAt <= this.now())
      return Promise.reject(timeoutError());
    // Include the source/kind in the disk and coalescing identity.
    const scoped = JSON.stringify([sourceId, kind, key]);
    let task = this.pending.get(scoped);
    if (!task) {
      task = { sourceId, controller: new AbortController(), subscribers: 0 };
      const generation = this.generations.get(sourceId) || 0;
      task.promise = (async () => {
        const saved = await this.load(scoped);
        if (task.controller.signal.aborted) throw abortError();
        const age = saved ? this.now() - saved.fetchedAt : Infinity;
        if (saved && age >= 0 && age < periods[kind][0]) return { data: saved.data, stale: false };
        try {
          const data = await loader({ signal: task.controller.signal, priority: context.priority });
          if (task.controller.signal.aborted) throw abortError();
          await this.save(scoped, { sourceId, kind, fetchedAt: this.now(), data }, generation);
          return { data, stale: false };
        } catch (e) {
          const currentAge = saved ? this.now() - saved.fetchedAt : Infinity;
          if (
            !task.controller.signal.aborted &&
            saved &&
            currentAge >= 0 &&
            currentAge <= periods[kind][1] &&
            !['AbortError', 'TimeoutError'].includes(e.name) &&
            (!e.status || e.status >= 500)
          )
            return { data: saved.data, stale: true };
          throw e;
        }
      })().finally(() => {
        if (this.pending.get(scoped) === task) this.pending.delete(scoped);
      });
      this.pending.set(scoped, task);
    }
    task.subscribers++;
    return new Promise((resolve, reject) => {
      let settled = false,
        timer;
      const finish = (fn, value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        context.signal?.removeEventListener('abort', abort);
        task.subscribers--;
        if (!task.subscribers) {
          task.controller.abort();
          if (this.pending.get(scoped) === task) this.pending.delete(scoped);
        }
        fn(value);
      };
      const abort = () => finish(reject, abortError());
      context.signal?.addEventListener('abort', abort, { once: true });
      if (context.deadlineAt != null)
        timer = setTimeout(
          () => finish(reject, timeoutError()),
          Math.max(1, context.deadlineAt - this.now()),
        );
      task.promise.then(
        (v) => finish(resolve, v),
        (e) => finish(reject, e),
      );
    });
  }
}
