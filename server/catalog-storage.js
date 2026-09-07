import { readFileSync, existsSync, mkdirSync, writeFileSync, renameSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectDir = dirname(dirname(fileURLToPath(import.meta.url)));
const seedPath = join(projectDir, 'server', 'seed.json');
const diskPath = join(
  process.env.DATA_DIR || process.env.YORU_DATA_DIR || join(projectDir, 'data'),
  'catalog-cache.json',
);

function loadFile(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}
export const seed = loadFile(seedPath) || { items: [], generatedAt: null };
export const persisted = existsSync(diskPath) ? loadFile(diskPath) : null;
const requestState = { pending: new Map(), requestQueue: Promise.resolve() };
export const getRequestState = () => requestState;
export const isOffline = () => process.env.CATALOG_OFFLINE === '1';
export const background = (promise) => {
  promise.catch(() => {});
};
let saveTimer;
export function saveCatalog(snapshot) {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    try {
      mkdirSync(dirname(diskPath), { recursive: true });
      writeFileSync(`${diskPath}.tmp`, JSON.stringify(snapshot()));
      renameSync(`${diskPath}.tmp`, diskPath);
    } catch (error) {
      console.warn('Catalog cache could not be saved:', error.message);
    }
  }, 1000);
  saveTimer.unref?.();
}
