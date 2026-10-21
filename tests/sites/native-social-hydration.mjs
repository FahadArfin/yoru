// Wrap only the local D1 fixture's equivalence lookup, after social selection.
// Production Worker bytes and the shared harness remain unchanged.
export function socialHydrationRuntimeOptions(options) {
  for (const worker of options.workers) {
    const entry = Object.entries(worker.config.manifest.modules).find(([path]) =>
      path.endsWith('/entry.mjs'),
    )?.[1];
    const marker = 'return app.fetch(request,env,ctx);';
    if (!entry.contents.includes(marker)) throw new Error('Social hydration fixture seam moved');
    entry.contents = entry.contents.replace(
      marker,
      `
      const raw = env.DB;
      const DB = {
        prepare(sql) {
          const statement = raw.prepare(sql);
          if (!sql.startsWith('SELECT * FROM reader_equivalences WHERE')) return statement;
          const wrap = (value) => ({
            bind(...args) { return wrap(value.bind(...args)); },
            async all() {
              await fetch('https://native-social.trycloudflare.com/__test/social-hydration', {method:'POST'});
              return value.all();
            },
          });
          return wrap(statement);
        },
        batch(statements) { return raw.batch(statements); },
      };
      return app.fetch(request,{...env,DB},ctx);`,
    );
  }
  return options;
}
