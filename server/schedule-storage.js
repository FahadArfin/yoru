import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
const directory =
  process.env.DATA_DIR ||
  process.env.YORU_DATA_DIR ||
  join(dirname(fileURLToPath(import.meta.url)), '../data');
const leases = new Map();
const cacheFile = (key) =>
  `${key.length > 140 ? createHash('sha256').update(key).digest('hex') : key.replaceAll(':', '-')}.json`;
export const scheduleOptions = {
  get token() {
    return process.env.ANIMESCHEDULE_API_TOKEN || '';
  },
  async claim(key, now) {
    for (const [oldKey, until] of leases) if (until <= now) leases.delete(oldKey);
    if (leases.has(key)) return false;
    leases.set(key, now + 120000);
    return true;
  },
  async load(key) {
    try {
      return JSON.parse(await readFile(join(directory, cacheFile(key)), 'utf8'));
    } catch {
      return null;
    }
  },
  async save(key, data) {
    await mkdir(directory, { recursive: true });
    const path = join(directory, cacheFile(key));
    const tmp = `${path}.${crypto.randomUUID()}.tmp`;
    await writeFile(tmp, JSON.stringify(data));
    await rename(tmp, path);
  },
};
