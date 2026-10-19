// Child-process fixture only: hold the exact post-selection equivalence lookup.
export async function load(url, context, nextLoad) {
  const result = await nextLoad(url, context);
  if (!url.endsWith('/server/external-catalog-store.js')) return result;
  const source = String(result.source);
  const marker = 'async getEquivalences(id) {';
  if (!source.includes(marker)) throw new Error('Social hydration fixture seam moved');
  return {
    ...result,
    source: source.replace(
      marker,
      `${marker}\nawait fetch(process.env.SOCIAL_HYDRATION_BARRIER, {method:'POST'});`,
    ),
  };
}
