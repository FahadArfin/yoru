export const sourceId = '9223372036854775806';
export const source = {
  id: sourceId,
  name: 'Synthetic',
  displayName: 'Synthetic',
  lang: 'en',
  contentWarning: 'MIXED',
  isNsfw: false,
  supportsLatest: true,
  extension: { pkgName: 'example.synthetic', isInstalled: true },
};
export const manga = {
  id: 7,
  sourceId,
  url: '/series/new',
  realUrl: 'https://example.invalid/series/new',
  title: 'New unindexed title',
  thumbnailUrl: null,
  initialized: false,
  genre: [],
  description: null,
  author: null,
  artist: null,
  status: 'UNKNOWN',
};
export function fixtureFetch(overrides = {}) {
  return async (_url, options) => {
    const { query, variables } = JSON.parse(options.body);
    if (query.includes('RemoteFeed'))
      return Response.json({
        data: {
          fetchSourceManga: {
            mangas: variables.input.page === 1 ? [manga] : [],
            hasNextPage: true,
          },
        },
      });
    if (query.includes('RefreshDetails')) return Response.json({ data: { fetchManga: { manga } } });
    if (query.includes('SourceById'))
      return Response.json({ data: { source: { ...source, ...overrides } } });
    if (query.includes('YoruSources') || query.includes('ExtensionSources'))
      return Response.json({
        data: {
          sources: {
            nodes: [{ ...source, ...overrides }],
            pageInfo: { hasNextPage: false, endCursor: null },
          },
        },
      });
    throw new Error('Unexpected fixture operation');
  };
}
