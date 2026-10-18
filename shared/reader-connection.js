// Fixed, read-only operations shared by the browser and the private reader bridge.
export function normalizeServerUrl(value) {
  const text = String(value || '').trim();
  if (!text) throw new Error('Enter a Suwayomi server address.');
  let url;
  try {
    url = new URL(
      /^[a-z][a-z\d+.-]*:/i.test(text) && !/^[^/]+:\d+(?:\/|$)/.test(text)
        ? text
        : `https://${text}`,
    );
  } catch {
    throw new Error('Enter a valid server address.');
  }
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new Error(
      'Use an HTTP or HTTPS server address without passwords, query parameters or fragments.',
    );
  if (
    /\.(?:json|apk)\/?$/i.test(url.pathname) ||
    ['github.com', 'raw.githubusercontent.com'].includes(url.hostname)
  )
    throw new Error('This is an extension repository, not a running Suwayomi server.');
  return `${url.origin}${url.pathname.replace(/\/+$/, '').replace(/\/api\/graphql$/, '')}`;
}

async function request(server, query, variables, options) {
  const timeout = AbortSignal.timeout(15000);
  const signal = options.signal ? AbortSignal.any([timeout, options.signal]) : timeout;
  let response;
  try {
    response = await (options.fetchImpl || fetch)(`${normalizeServerUrl(server)}/api/graphql`, {
      method: 'POST',
      credentials: 'omit',
      redirect: 'error',
      signal,
      headers: {
        'content-type': 'application/json',
        ...(options.authorization ? { authorization: options.authorization } : {}),
      },
      body: JSON.stringify({ query, variables }),
    });
  } catch {
    if (options.signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
    throw new Error(
      timeout.aborted
        ? 'The server took too long to respond. Try again.'
        : 'Cannot reach this server. Check its address, HTTPS and browser access (CORS).',
    );
  }
  if ([401, 403].includes(response.status))
    throw new Error('This server requires sign-in. Check your server credentials.');
  if (!response.ok) throw new Error('The server is unavailable. Try again shortly.');
  if (!response.body || Number(response.headers.get('content-length')) > 1024 ** 2)
    throw new Error('The server response is too large or empty.');
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 1024 ** 2) throw new Error('The server response is too large.');
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  const all = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    all.set(chunk, offset);
    offset += chunk.byteLength;
  }
  let body;
  try {
    body = JSON.parse(new TextDecoder().decode(all));
  } catch {
    throw new Error('This address did not return a compatible Suwayomi response.');
  }
  if (body.errors?.length) {
    const legacy = body.errors.every((e) =>
      /Cannot query field "contentWarning"/.test(e.message || ''),
    );
    throw Object.assign(new Error('This server does not support this catalog request.'), {
      legacy,
    });
  }
  return body.data;
}

export async function discoverCatalogs(server, options = {}) {
  let data,
    legacy = false;
  try {
    data = await request(
      server,
      'query YoruSources { sources { nodes { id name lang isNsfw contentWarning } } }',
      {},
      options,
    );
  } catch (error) {
    if (!error.legacy) throw error;
    legacy = true;
    data = await request(
      server,
      'query YoruSources { sources { nodes { id name lang isNsfw } } }',
      {},
      options,
    );
  }
  if (!Array.isArray(data?.sources?.nodes))
    throw new Error('This address is not a compatible Suwayomi server.');
  const nodes = data.sources.nodes;
  const sources = [
    ...new Map(
      nodes
        .filter(
          (s) =>
            /^[1-9]\d{0,23}$/.test(s.id) &&
            typeof s.name === 'string' &&
            s.name.trim() &&
            s.isNsfw === false &&
            (legacy || s.contentWarning === 'SAFE'),
        )
        .map((s) => [
          String(s.id),
          {
            id: String(s.id),
            name: s.name.slice(0, 100),
            language: String(s.lang || '').slice(0, 20),
          },
        ]),
    ).values(),
  ];
  return { sources, excluded: nodes.length - sources.length };
}

export async function browseCatalog(server, source, query = '', offset = 0, options = {}) {
  const { sources } = await discoverCatalogs(server, options);
  if (!sources.some((s) => s.id === source))
    throw new Error('This catalog is not available. Reconnect to refresh the list.');
  if (
    typeof query !== 'string' ||
    query.length > 100 ||
    !Number.isInteger(offset) ||
    offset < 0 ||
    offset > 10000
  )
    throw new Error('Invalid catalog search.');
  const data = await request(
    server,
    `query YoruCatalog($source: LongString!, $query: String!, $offset: Int!) {
    mangas(first: 20, offset: $offset, filter: {sourceId: {equalTo: $source}, title: {includesInsensitive: $query}}) {
      nodes { id sourceId title genre } pageInfo { hasNextPage }
    }
  }`,
    { source, query, offset },
    options,
  );
  if (!Array.isArray(data?.mangas?.nodes))
    throw new Error('The server returned an incompatible catalog.');
  return {
    items: data.mangas.nodes
      .filter(
        (m) =>
          String(m.sourceId) === source &&
          typeof m.title === 'string' &&
          Array.isArray(m.genre) &&
          !m.genre.some((g) => /\b(?:hentai|pornographic|explicit sex)\b/i.test(g)),
      )
      .slice(0, 20)
      .map((m) => ({ id: String(m.id), title: m.title.slice(0, 300), sourceId: source })),
    hasNextPage: data.mangas.pageInfo?.hasNextPage === true,
  };
}
