// Reviewed core shelves remain editorial; native titles resolve through destination policy.
export function collectionRequest(path, active) {
  if (!active || !path) return path;
  const url = new URL(path, 'https://yoru.local');
  if (/^\/api\/media\/ext-manga-[a-f0-9]{32}$/.test(url.pathname)) {
    url.searchParams.set('destination', 'ara-ara');
    return url.pathname + url.search;
  }
  if (
    /^\/api\/(home|manga|manhwa)\/discovery$/.test(url.pathname) &&
    ['new', 'popular'].includes(url.searchParams.get('mode'))
  )
    return null;
  if (url.pathname === '/api/catalog' || /^\/api\/media\/[^/]+$/.test(url.pathname)) return null;
  if (
    url.pathname.startsWith('/api/forum/') ||
    ['/api/calendar', '/api/chapter-calendar', '/api/community'].includes(url.pathname)
  ) {
    url.searchParams.set('collection', 'ara-ara');
    return url.pathname + url.search;
  }
  return path;
}

export function collectionView(path, data, catalog) {
  if (!path || !catalog) return data;
  const url = new URL(path, 'https://yoru.local');
  if (/^\/api\/media\/ext-manga-[a-f0-9]{32}$/.test(url.pathname)) return data;
  const p = url.searchParams;
  const all = catalog.items || [];
  const ids = new Set(all.map((item) => item.id));
  const belongs = (item) => ids.has(item.mediaId || item.media?.id || item.id);
  if (/^\/api\/media\/[^/]+$/.test(url.pathname))
    return all.find((item) => item.id === url.pathname.split('/').pop()) || null;
  if (url.pathname === '/api/catalog') {
    const category = p.get('category')?.toUpperCase();
    const search = (p.get('search') || '').trim().toLowerCase();
    const items = all.filter(
      (item) =>
        (!category || category === 'ALL' || item.category === category) &&
        (!p.get('genre') || item.genres?.includes(p.get('genre'))) &&
        (!p.get('format') || item.format?.toLowerCase() === p.get('format').toLowerCase()) &&
        [item.title, item.titleEnglish, item.titleRomaji, item.titleJapanese].some((title) =>
          title?.toLowerCase().includes(search),
        ),
    );
    const sort = p.get('sort');
    items.sort((a, b) =>
      sort === 'title'
        ? a.title.localeCompare(b.title)
        : sort === 'newest'
          ? (Date.parse(b.startDate) || b.year || 0) - (Date.parse(a.startDate) || a.year || 0)
          : sort === 'score'
            ? (b.score || 0) - (a.score || 0)
            : (a.popularity || Infinity) - (b.popularity || Infinity),
    );
    const limit = Math.max(1, Math.min(100, Number(p.get('limit')) || 48));
    const page = Math.max(1, Number(p.get('page')) || 1);
    return {
      items: items.slice((page - 1) * limit, page * limit),
      total: items.length,
      pages: Math.max(1, Math.ceil(items.length / limit)),
      source: 'ara-ara',
      state: 'ready',
    };
  }
  if (
    /^\/api\/(home|manga|manhwa)\/discovery$/.test(url.pathname) &&
    ['new', 'popular'].includes(p.get('mode'))
  ) {
    const category =
      url.pathname.split('/')[2] === 'home' ? 'ANIME' : url.pathname.split('/')[2].toUpperCase();
    const query = new URLSearchParams({
      category,
      sort: p.get('mode') === 'new' ? 'newest' : 'trending',
    });
    let items = collectionView(`/api/catalog?${query}`, null, catalog).items;
    if (p.get('mode') === 'popular' && ['month', 'year'].includes(p.get('period'))) {
      const since = Date.now() - (p.get('period') === 'month' ? 31 : 366) * 86400000;
      items = items.filter((item) => Date.parse(item.startDate) >= since);
    }
    return {
      items,
      mode: p.get('mode'),
      period: p.get('period'),
      state: 'ready',
      source: 'ara-ara',
      caption: 'From the Ara Ara collection',
    };
  }
  if (!data) return data;
  if (url.pathname === '/api/home')
    return {
      ...data,
      hot: all.filter((item) => item.category === 'ANIME'),
      releases: (data.releases || []).filter(belongs),
    };
  if (
    /^\/api\/(home|manga|manhwa)\/discovery$/.test(url.pathname) ||
    ['/api/rooms', '/api/community/threads', '/api/community'].includes(url.pathname)
  )
    return { ...data, items: (data.items || []).filter(belongs) };
  return data;
}
