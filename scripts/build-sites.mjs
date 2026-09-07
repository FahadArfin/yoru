import { spawnSync } from 'node:child_process';
import { existsSync, unlinkSync, readFileSync, readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';

const result = spawnSync(
  process.execPath,
  ['node_modules/vite/bin/vite.js', 'build', '--config', 'vite.sites.config.js'],
  { stdio: 'inherit', env: { ...process.env, CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV: 'false' } },
);
if (result.status !== 0) process.exit(result.status || 1);
// Cloudflare's plugin may copy a local .dev.vars file. Never upload that copy.
const copiedVars = resolve('dist/server/.dev.vars');
if (existsSync(copiedVars)) unlinkSync(copiedVars);
for (const name of readdirSync('dist', { recursive: true })) {
  const basename = String(name).split(/[\\/]/).at(-1);
  if (/^\.env(?:\.|$)|^\.dev\.vars/.test(basename))
    throw new Error('A local environment file was emitted into the Sites artifact.');
}
const manifest = JSON.parse(readFileSync('dist/.openai/hosting.json', 'utf8'));
if (manifest.d1 !== 'DB') throw new Error('Sites must provision the DB binding.');
for (const required of [
  'server/index.js',
  'client/index.html',
  '.openai/drizzle/meta/_journal.json',
])
  if (!existsSync(join('dist', required))) throw new Error(`Missing Sites output: ${required}`);
