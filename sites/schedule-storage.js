export function scheduleOptions(env) {
  return {
    token: env.ANIMESCHEDULE_API_TOKEN || '',
    async claim(key, now) {
      const result = await env.DB.prepare(
        `INSERT INTO catalog_pages(query_key,payload,fetched_at) VALUES(?,'{}',?) ON CONFLICT(query_key) DO UPDATE SET fetched_at=excluded.fetched_at WHERE catalog_pages.fetched_at<=?`,
      )
        .bind(`lease:${key}`, now, now - 120000)
        .run();
      return result.meta.changes === 1;
    },
    async load(key) {
      const row = await env.DB.prepare('SELECT payload FROM catalog_pages WHERE query_key=?')
        .bind(key)
        .first();
      return row ? JSON.parse(row.payload) : null;
    },
    async save(key, data) {
      await env.DB.prepare(
        `INSERT INTO catalog_pages(query_key,payload,fetched_at) VALUES(?,?,?) ON CONFLICT(query_key) DO UPDATE SET payload=excluded.payload,fetched_at=excluded.fetched_at WHERE excluded.fetched_at>=catalog_pages.fetched_at`,
      )
        .bind(key, JSON.stringify(data), data.fetchedAt)
        .run();
    },
  };
}
