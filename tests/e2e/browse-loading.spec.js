import { test, expect } from '@playwright/test';
import { readerImage } from '../fixtures/reader-image.mjs';

const chapterId = '11111111-2222-4333-8444-555555555555';
const image = readerImage();
const manifestPath = `/api/media/mal-manga-21/reader/${chapterId}`;
function readerContext(request) {
  const params = new URL(request.url()).searchParams;
  expect(params.get('destination')).toBe('yoru');
  expect(params.get('integration')).toBe('all');
  expect(params.get('selectionFingerprint')).toBeTruthy();
}
async function fixtures(page, context, baseURL) {
  await context.route('**/*', (route) =>
    new URL(route.request().url()).origin === baseURL ? route.continue() : route.abort(),
  );
  await page.route(/\/api\/media\/[^/]+\/reading-sources(?:\?|$)/, (route) =>
    route.fulfill({ json: { state: 'ready', sources: [{ id: 'mangadex', name: 'MangaDex' }] } }),
  );
  await page.route('**/api/media/*/chapters?*', (route) =>
    route.fulfill({
      json: {
        state: 'ready',
        total: 1,
        nextOffset: null,
        languages: ['en'],
        items: [
          {
            id: chapterId,
            number: '1',
            title: 'First edition',
            language: 'en',
            groups: [],
            pages: 3,
            native: true,
            source: 'mangadex',
            readLabel: 'MangaDex',
            readUrl: `/read/mal-manga-21/1?chapter=${chapterId}&language=en`,
          },
        ],
      },
    }),
  );
  await page.route(`**${manifestPath}/page/*`, (route) =>
    route.fulfill({ contentType: 'image/png', body: image }),
  );
  let manifests = 0;
  await page.route(
    (url) => url.pathname === manifestPath,
    (route) => {
      readerContext(route.request());
      manifests++;
      return route.fulfill({
        json: {
          id: chapterId,
          kind: 'remote',
          number: '1',
          language: 'en',
          title: 'First edition',
          group: 'Example group',
          pages: [0, 1, 2].map((n) => ({ url: `${manifestPath}/page/${n}` })),
        },
      });
    },
  );
  return () => manifests;
}

test('personal chapter data is not fetched into the guest cache while identity is still loading', async ({
  page,
  context,
  baseURL,
}) => {
  await fixtures(page, context, baseURL);
  let release;
  const paused = new Promise((resolve) => {
    release = resolve;
  });
  let chapterRequests = 0;
  await page.route('**/api/auth/me', async (route) => {
    await paused;
    return route.fulfill({ json: { user: null } });
  });
  await page.route('**/api/media/*/chapters?*', (route) => {
    chapterRequests++;
    return route.fulfill({ json: { items: [], total: 0, languages: ['en'], nextOffset: null } });
  });
  try {
    await page.goto('/title/mal-manga-21');
    await expect(page.locator('.manga-detail-cover')).toBeVisible();
    await page.waitForTimeout(300);
    expect(chapterRequests).toBe(0);
    release();
    await expect.poll(() => chapterRequests).toBe(1);
  } finally {
    release();
  }
});

test('failed main and recommendation covers recover to a usable image', async ({
  page,
  context,
  baseURL,
}) => {
  await fixtures(page, context, baseURL);
  const original = await (await context.request.get('/api/media/mal-manga-21')).json();
  const media = original.media || original;
  await page.route('**/api/media/mal-manga-21', (route) =>
    route.fulfill({
      json: {
        ...media,
        cover: 'https://cdn.myanimelist.net/images/manga/1/123l.webp',
      },
    }),
  );
  await page.route('**/api/catalog?*', (route) =>
    route.fulfill({
      json: {
        items: [
          {
            id: 'mal-manga-999001',
            title: 'Recovering recommendation',
            category: 'MANGA',
            genres: media.genres,
            cover: 'https://cdn.myanimelist.net/images/manga/2/456l.webp',
          },
        ],
      },
    }),
  );
  await page.route('https://cdn.myanimelist.net/**', (route) =>
    route.request().url().endsWith('.webp')
      ? route.abort('failed')
      : route.fulfill({ contentType: 'image/png', body: image }),
  );
  await page.goto('/title/mal-manga-21');
  const cover = page.locator('.manga-detail-cover');
  await expect.poll(() => cover.evaluate((img) => img.complete && img.naturalWidth > 0)).toBe(true);
  await expect(cover).toHaveAttribute('src', /123l\.jpg$/);
  const recommendation = page.locator('.manga-recommendation-card img');
  await recommendation.scrollIntoViewIfNeeded();
  await expect
    .poll(() => recommendation.evaluate((img) => img.complete && img.naturalWidth > 0))
    .toBe(true);
  await expect(recommendation).toHaveAttribute('src', /456l\.jpg$/);
});

test('a failed identity check keeps personal ratings hidden after an external chapter open', async ({
  page,
  context,
  baseURL,
}) => {
  await fixtures(page, context, baseURL);
  await page.route('**/api/auth/me', (route) =>
    route.fulfill({ status: 503, json: { error: 'Unavailable' } }),
  );
  await page.route('**/api/media/*/chapters?*', (route) =>
    route.fulfill({
      json: {
        total: 1,
        nextOffset: null,
        languages: ['en'],
        items: [
          {
            id: chapterId,
            number: '1',
            title: 'External edition',
            language: 'en',
            groups: [],
            native: false,
            readUrl: `${baseURL}/external-test`,
            readLabel: 'Publisher',
            stats: { opens: 0, votes: 2, rating: 4, myRating: 4 },
          },
        ],
      },
    }),
  );
  await page.route(/\/api\/media\/[^/]+\/chapters\/[^/]+\/open(?:\?|$)/, (route) => {
    readerContext(route.request());
    return route.fulfill({ json: { opens: 7, votes: 2, rating: 4, myRating: 4 } });
  });
  await page.route('**/external-test', (route) =>
    route.fulfill({ contentType: 'text/html', body: '<p>Publisher</p>' }),
  );
  await page.goto('/title/mal-manga-21');
  const rating = page.getByRole('button', { name: 'Rate Chapter 1 in English', exact: true });
  await expect(rating).not.toHaveClass(/rated/);
  const popup = context.waitForEvent('page');
  await page.locator('.live-chapter-link').click();
  await (await popup).close();
  await expect(page.locator('.chapter-open-count')).toContainText('7');
  await expect(rating).not.toHaveClass(/rated/);
});

test('chapter intent prepares pages and opening it retains the app and prepared manifest', async ({
  page,
  context,
  baseURL,
}) => {
  const manifests = await fixtures(page, context, baseURL);
  await page.goto('/title/mal-manga-21');
  const chapter = page.locator('.live-chapter-link').first();
  await chapter.focus();
  await expect.poll(manifests).toBe(1);
  await page.evaluate(() => {
    window.readerNavigationMarker = 'same-document';
  });
  await chapter.click();
  await expect(page.locator('.reader-canvas img').first()).toBeVisible();
  expect(await page.evaluate(() => window.readerNavigationMarker)).toBe('same-document');
  expect(manifests()).toBe(1);
});

test('an explicit chapter opens while unrelated source discovery is still waiting', async ({
  page,
  context,
  baseURL,
}) => {
  await fixtures(page, context, baseURL);
  let release;
  const paused = new Promise((resolve) => {
    release = resolve;
  });
  await page.route(/\/api\/media\/[^/]+\/reading-sources(?:\?|$)/, async (route) => {
    await paused;
    await route.fulfill({
      json: { state: 'ready', sources: [{ id: 'mangadex', name: 'MangaDex' }] },
    });
  });
  try {
    await page.goto(`/read/mal-manga-21/1?chapter=${chapterId}&language=en`);
    await expect(page.locator('.reader-canvas img').first()).toBeVisible({ timeout: 3000 });
  } finally {
    release();
  }
});

test('reading prepares five pages ahead and the next chapter after halfway', async ({
  page,
  context,
  baseURL,
}) => {
  await fixtures(page, context, baseURL);
  const next = '22222222-2222-4333-8444-555555555555';
  const nextPath = `/api/media/mal-manga-21/reader/${next}`;
  const requests = new Set();
  let nextManifests = 0;
  await page.route('**/api/media/*/chapters?*', (route) =>
    route.fulfill({
      json: {
        total: 2,
        nextOffset: null,
        languages: ['en'],
        items: [chapterId, next].map((id, i) => ({
          id,
          number: String(i + 1),
          language: 'en',
          groups: [],
          native: true,
          source: 'mangadex',
          pages: 10,
          readLabel: 'MangaDex',
        })),
      },
    }),
  );
  await page.route(/\/api\/media\/[^/]+\/reader\/[^/?]+(?:\?|$)/, (route) => {
    readerContext(route.request());
    const path = new URL(route.request().url()).pathname;
    const id = path.split('/').at(-1);
    if (id === next) nextManifests++;
    return route.fulfill({
      json: {
        id,
        kind: 'remote',
        number: id === next ? '2' : '1',
        language: 'en',
        group: 'MangaDex',
        pages: Array.from({ length: 10 }, (_, n) => ({ url: `${path}/page/${n}` })),
      },
    });
  });
  await page.route('**/api/media/*/reader/*/page/*', (route) => {
    requests.add(new URL(route.request().url()).pathname);
    return route.fulfill({ contentType: 'image/png', body: image });
  });
  await page.goto(`/read/mal-manga-21/1?chapter=${chapterId}&language=en`);
  await expect(page.locator('.reader-canvas img').first()).toBeVisible();
  await expect.poll(() => requests.has(`${manifestPath}/page/5`)).toBe(true);
  expect(nextManifests).toBe(0);
  await page.locator('.reader-canvas').focus();
  for (let n = 0; n < 4; n++) await page.keyboard.press('ArrowLeft');
  await expect(page).toHaveURL(/page=5/);
  await expect.poll(() => nextManifests).toBe(1);
  await expect.poll(() => requests.has(`${nextPath}/page/2`)).toBe(true);
  expect(requests.has(`${nextPath}/page/3`)).toBe(false);
});

test('recommendation intent prepares title and chapters once, then reuses them on navigation', async ({
  page,
  context,
  baseURL,
}) => {
  await fixtures(page, context, baseURL);
  const original = await (await context.request.get('/api/media/mal-manga-21')).json();
  const media = {
    ...(original.media || original),
    id: 'mal-manga-999001',
    title: 'Prepared recommendation',
  };
  const counts = { title: 0, chapters: 0 };
  await page.route('**/api/catalog?*', (route) => route.fulfill({ json: { items: [media] } }));
  await page.route(/\/api\/media\/mal-manga-999001(?:\?|$)/, (route) => {
    counts.title++;
    return route.fulfill({ json: media });
  });
  await page.route('**/api/media/mal-manga-999001/chapters?*', (route) => {
    counts.chapters++;
    return route.fulfill({ json: { total: 0, items: [], languages: ['en'], nextOffset: null } });
  });
  await page.goto('/title/mal-manga-21');
  const card = page.locator('.manga-recommendation-card').first();
  await card.focus();
  await expect.poll(() => counts.chapters).toBe(1);
  await card.click();
  await expect(page.getByRole('heading', { name: media.title, exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Live chapter catalog' })).toBeVisible();
  expect(counts).toEqual({ title: 1, chapters: 1 });
});

test('data saver loads the selected page without speculative chapter or page requests', async ({
  page,
  context,
  baseURL,
}) => {
  await fixtures(page, context, baseURL);
  await page.addInitScript(() =>
    Object.defineProperty(navigator, 'connection', {
      value: { saveData: true, effectiveType: '4g' },
    }),
  );
  const pages = new Set();
  await page.route(`**${manifestPath}/page/*`, (route) => {
    pages.add(new URL(route.request().url()).pathname);
    return route.fulfill({ contentType: 'image/png', body: image });
  });
  await page.goto(`/read/mal-manga-21/1?chapter=${chapterId}&language=en`);
  const displayed = page.locator('.reader-canvas img').first();
  await expect
    .poll(() => displayed.evaluate((img) => img.complete && img.naturalWidth > 0))
    .toBe(true);
  await page.waitForTimeout(600);
  expect([...pages]).toEqual([`${manifestPath}/page/0`]);
});

test('unavailable covers stop retrying and show the local fallback instead of blank artwork', async ({
  page,
  context,
  baseURL,
}) => {
  await fixtures(page, context, baseURL);
  let releaseContext;
  const contextGate = new Promise((resolve) => {
    releaseContext = resolve;
  });
  await page.route(/\/api\/reader\/context(?:\?|$)/, async (route) => {
    await contextGate;
    await route.continue();
  });
  const original = await (await context.request.get('/api/media/mal-manga-21')).json();
  let attempts = 0;
  await page.route('**/api/media/mal-manga-21', (route) =>
    route.fulfill({
      json: {
        ...(original.media || original),
        cover: 'https://cdn.myanimelist.net/images/manga/1/123l.webp',
      },
    }),
  );
  await page.route('https://cdn.myanimelist.net/images/manga/1/123l.*', (route) => {
    attempts++;
    return route.abort('failed');
  });
  try {
    await page.goto('/title/mal-manga-21');
    const cover = page.locator('.manga-detail-cover');
    await expect(cover).toHaveAttribute('src', '/cover-placeholder.svg');
    await expect
      .poll(() => cover.evaluate((img) => img.complete && img.naturalWidth > 0))
      .toBe(true);
    expect(attempts).toBe(3);
    releaseContext();
    await expect(page.locator('.live-chapter-link').first()).toBeVisible();
    await expect(cover).toHaveAttribute('src', '/cover-placeholder.svg');
    expect(attempts).toBe(3);
  } finally {
    releaseContext();
  }
});
