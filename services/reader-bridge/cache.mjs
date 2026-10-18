import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, rename, readdir, stat, unlink } from 'node:fs/promises';
import { join } from 'node:path';

export class ImageCache {
  constructor(directory, { maxBytes = 1024 ** 3, ttl = 72 * 3600000, now = Date.now } = {}) {
    Object.assign(this, { directory, maxBytes, ttl, now });
    this.queue = Promise.resolve();
  }
  path(key) {
    return join(this.directory, createHash('sha256').update(key).digest('hex'));
  }
  async get(key) {
    const path = this.path(key);
    try {
      const info = JSON.parse(await readFile(`${path}.json`, 'utf8'));
      if (this.now() - info.createdAt >= this.ttl) {
        await this.remove(path);
        return null;
      }
      return { body: await readFile(path), type: info.type };
    } catch {
      return null;
    }
  }
  async remove(path) {
    await Promise.all([unlink(path).catch(() => {}), unlink(`${path}.json`).catch(() => {})]);
  }
  async put(key, body, type) {
    if (body.length > this.maxBytes) return;
    const run = async () => {
      await mkdir(this.directory, { recursive: true });
      const path = this.path(key);
      const tmp = `${path}.${crypto.randomUUID()}.tmp`;
      await writeFile(tmp, body);
      await rename(tmp, path);
      await writeFile(`${path}.json`, JSON.stringify({ type, createdAt: this.now() }));
      await this.clean();
    };
    this.queue = this.queue.catch(() => {}).then(run);
    await this.queue;
  }
  async prune() {
    this.queue = this.queue.catch(() => {}).then(() => this.clean());
    await this.queue;
  }
  async clean() {
    const entries = [];
    for (const name of await readdir(this.directory).catch(() => [])) {
      // An interrupted atomic write must not survive outside the cache budget forever.
      // Maintenance shares the write queue; the age grace also protects recent external writes.
      if (/^[a-f0-9]{64}\.[a-f0-9-]{36}\.tmp$/.test(name)) {
        const temporary = join(this.directory, name);
        const info = await stat(temporary).catch(() => null);
        if (info && this.now() - info.mtimeMs > 3600000) await unlink(temporary).catch(() => {});
        continue;
      }
      if (!/^[a-f0-9]{64}$/.test(name)) continue;
      const file = join(this.directory, name);
      const info = await stat(file).catch(() => null);
      if (!info) continue;
      const meta = await readFile(`${file}.json`, 'utf8')
        .then(JSON.parse)
        .catch(() => null);
      if (!meta || this.now() - meta.createdAt >= this.ttl) await this.remove(file);
      else entries.push({ file, size: info.size, time: meta.createdAt });
    }
    let total = entries.reduce((n, x) => n + x.size, 0);
    for (const entry of entries.sort((a, b) => a.time - b.time)) {
      if (total <= this.maxBytes) break;
      await this.remove(entry.file);
      total -= entry.size;
    }
  }
}

// This is only called on the dedicated Docker cache volume, never the Suwayomi data volume.
export async function pruneSuwayomiCache(root, { maxBytes = 1024 ** 3, ttl = 72 * 3600000 } = {}) {
  const files = [];
  async function walk(dir) {
    for (const item of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
      const path = join(dir, item.name);
      if (item.isDirectory()) await walk(path);
      else if (item.isFile()) {
        const info = await stat(path).catch(() => null);
        if (info) files.push({ path, size: info.size, time: info.mtimeMs });
      }
    }
  }
  await walk(root);
  let total = files.reduce((n, f) => n + f.size, 0);
  for (const item of files.sort((a, b) => a.time - b.time)) {
    if (Date.now() - item.time > ttl || total > maxBytes) {
      await unlink(item.path).catch(() => {});
      total -= item.size;
    }
  }
}
