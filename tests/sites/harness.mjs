import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

const script = () => readFileSync('dist/server/index.js', 'utf8');
const harness = `import app from './application.js';
export default {async fetch(request,env,ctx) {
  const path=new URL(request.url).pathname;
  if(path==='/__test/sql') {
    const statements=await request.json();
    const results=await env.DB.batch(statements.map(([sql,...values])=>env.DB.prepare(sql).bind(...values)));
    return Response.json(results);
  }
  if(path==='/__test/instance') return Response.json({instance:env.INSTANCE});
  return app.fetch(request,env,ctx);
}};`;

export function runtimeOptions({
  port = 0,
  persist,
  assets = false,
  bindings = {},
  provider,
} = {}) {
  return convertV4MiniflareOptions({
    cf: false,
    port,
    host: '127.0.0.1',
    ...(persist ? { resourcePersistencePath: persist } : {}),
    workers: ['a', 'b'].map((name) => ({
      name,
      // Parallel test runtimes must not register/reload each other's named Workers.
      unsafeRegisterWorker: false,
      routes: [`${name}.test/*`],
      compatibilityDate: '2026-09-07',
      compatibilityFlags: ['nodejs_compat'],
      modules: [
        { type: 'ESModule', path: resolve(`tests/sites/${name}/entry.mjs`), contents: harness },
        {
          type: 'ESModule',
          path: resolve(`tests/sites/${name}/application.js`),
          contents: script(),
        },
      ],
      d1Databases: { DB: 'yoru-shared-test' },
      ...(provider ? { outboundService: provider } : {}),
      ...(assets
        ? {
            assets: {
              directory: resolve('dist/client'),
              binding: 'ASSETS',
              routerConfig: { has_user_worker: true },
              assetConfig: { not_found_handling: 'single-page-application' },
            },
          }
        : {}),
      bindings: { CATALOG_OFFLINE: '1', YORU_TEST_MODE: '1', INSTANCE: name, ...bindings },
    })),
  });
}
export async function createRuntime(options = {}) {
  const runtime = new Miniflare(runtimeOptions(options));
  await runtime.ready;
  return runtime;
}
export async function sql(runtime, statements) {
  const response = await runtime.dispatchFetch('http://a.test/__test/sql', {
    method: 'POST',
    body: JSON.stringify(statements),
  });
  if (!response.ok) throw new Error(await response.text());
  return response.json();
}
export async function migrate(runtime) {
  for (const file of readdirSync('drizzle')
    .filter((x) => x.endsWith('.sql'))
    .sort()) {
    const statements = readFileSync(`drizzle/${file}`, 'utf8')
      .split('--> statement-breakpoint')
      .map((x) => x.trim())
      .filter(Boolean);
    // All tables are created before indexes and foreign-key-dependent writes.
    await sql(
      runtime,
      statements.map((statement) => [statement]),
    );
  }
}
