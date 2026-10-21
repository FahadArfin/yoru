import { test, expect } from '@playwright/test';
import { readerImage } from '../fixtures/reader-image.mjs';

const md = '11111111-2222-4333-8444-555555555555';
const sw = 'sw-weebcentral-8-90';
const es = '22222222-2222-4333-8444-555555555555';
const pixel = readerImage();
function assertContext(request) {
  const query = new URL(request.url()).searchParams;
  expect(query.get('destination')).toBe('yoru');
  expect(query.get('integration')).toBe('core');
  expect(query.get('selectionFingerprint')).toBeTruthy();
}
async function setup(page, context, baseURL) {
  await context.route('**/*', (route) =>
    new URL(route.request().url()).origin === baseURL ? route.continue() : route.abort(),
  );
  await page.route(/\/api\/media\/[^/]+\/reading-sources(?:\?.*)?$/, (route) => {
    assertContext(route.request());
    return route.fulfill({
      json: {
        state: 'ready',
        sources: [
          { id: 'mangadex', name: 'MangaDex' },
          { id: 'weebcentral', name: 'Weeb Central' },
        ],
      },
    });
  });
  await page.route('**/api/media/*/chapters?*', (route) => {
    assertContext(route.request());
    const query = new URL(route.request().url()).searchParams;
    const source = query.get('source');
    return route.fulfill({
      json: {
        state: 'ready',
        items: [
          {
            id: source === 'mangadex' ? (query.get('language') === 'es' ? es : md) : sw,
            number: query.get('language') === 'es' ? '2' : '1',
            title: source === 'mangadex' ? 'MangaDex edition' : 'Suwayomi edition',
            language: query.get('language') || 'en',
            groups: [],
            native: true,
            pages: 3,
            source,
            readLabel: source === 'mangadex' ? 'MD group' : 'SW group',
            readUrl: `/read/mal-manga-21/1?chapter=${source === 'mangadex' ? md : sw}`,
          },
        ],
        total: 1,
        nextOffset: null,
        languages: ['en', 'es'],
      },
    });
  });
  await page.route('**/api/media/*/reader/*/page/*', (route) =>
    route.fulfill({ contentType: 'image/png', body: pixel }),
  );
  await page.route(/\/api\/media\/[^/]+\/reader\/[^/?]+(?:\?.*)?$/, (route) => {
    assertContext(route.request());
    const url = new URL(route.request().url());
    const id = url.pathname.split('/').at(-1);
    return route.fulfill({
      json: {
        id,
        kind: 'remote',
        number: id === es ? '2' : '1',
        title: id === md ? 'MangaDex edition' : 'Suwayomi edition',
        language: id === es ? 'es' : 'en',
        group: id === md ? 'MD group' : 'SW group',
        pages: [0, 1, 2].map((i) => ({ url: `${url.pathname}/page/${i}` })),
      },
    });
  });
}
async function menu(page) {
  if (await page.getByRole('complementary', { name: 'Reader menu' }).isVisible())
    return page.getByRole('complementary', { name: 'Reader menu' });
  const dialog = page.getByRole('dialog', { name: 'Reader menu', exact: true });
  if (await dialog.isVisible()) return dialog;
  const reveal = page.getByRole('button', { name: 'Show chapter and page controls', exact: true });
  if (await reveal.isVisible()) await reveal.click();
  await page.getByRole('button', { name: 'Reader menu', exact: true }).click();
  return page.getByRole('dialog', { name: 'Reader menu', exact: true });
}

async function expectEdition(page, id) {
  const displayed = page.locator('.reader-canvas .comic-page').first();
  await expect(displayed).toHaveAttribute('data-edition', id);
  await expect(displayed).toHaveClass(/ready/);
}

test('reader automatically recovers a temporary page failure without changing pages', async ({
  page,
  context,
  baseURL,
}) => {
  await setup(page, context, baseURL);
  let attempts = 0;
  await page.route('**/api/media/*/reader/*/page/0?*', (route) => {
    attempts++;
    return attempts === 1
      ? route.fulfill({ status: 503, json: { error: 'Temporarily busy' } })
      : route.fulfill({ contentType: 'image/png', body: pixel });
  });
  await page.goto(`/read/mal-manga-21/1?chapter=${md}&source=mangadex`);
  await expect(page.locator('[data-page="1"]')).toHaveClass(/ready/, { timeout: 12000 });
  expect(attempts).toBe(2);
  await expect(page.getByRole('button', { name: 'Retry page 1', exact: true })).toHaveCount(0);
  await expect(page).toHaveURL(/chapter=11111111/);
});

test('long chapters load nearby pages once with bounded concurrency', async ({
  page,
  context,
  baseURL,
}) => {
  await setup(page, context, baseURL);
  const requests = new Map();
  let active = 0,
    peak = 0;
  await page.route(/\/api\/media\/[^/]+\/reader\/[^/?]+(?:\?.*)?$/, (route) => {
    const path = new URL(route.request().url()).pathname;
    return route.fulfill({
      json: {
        id: md,
        kind: 'remote',
        number: '1',
        language: 'en',
        pages: Array.from({ length: 40 }, (_, index) => ({ url: `${path}/page/${index}` })),
      },
    });
  });
  await page.route('**/api/media/*/reader/*/page/*', async (route) => {
    const path = new URL(route.request().url()).pathname;
    requests.set(path, (requests.get(path) || 0) + 1);
    active++;
    peak = Math.max(peak, active);
    await new Promise((resolve) => setTimeout(resolve, 150));
    await route.fulfill({ contentType: 'image/png', body: pixel });
    active--;
  });
  await page.goto(`/read/mal-manga-121496/1?chapter=${md}&source=mangadex`);
  await expect(page.locator('[data-page="1"]')).toHaveClass(/ready/);
  await expect(page.locator('[data-page="2"]')).toHaveClass(/ready/);
  expect(peak).toBeLessThanOrEqual(4);
  expect(requests.size).toBeLessThan(12);
  expect([...requests.values()].every((count) => count === 1)).toBe(true);
  const controls = await menu(page);
  await controls.getByLabel('Page number', { exact: true }).selectOption('33');
  await expect(page.locator('[data-page="33"]')).toHaveClass(/ready/);
  expect(peak).toBeLessThanOrEqual(4);
  expect([...requests.values()].every((count) => count === 1)).toBe(true);
});

test('unavailable pages stop retrying and retain a working manual retry', async ({
  page,
  context,
  baseURL,
}) => {
  await setup(page, context, baseURL);
  let attempts = 0,
    available = false;
  await page.route('**/api/media/*/reader/*/page/0?*', (route) => {
    attempts++;
    return available
      ? route.fulfill({ contentType: 'image/png', body: pixel })
      : route.fulfill({ status: 503, json: { error: 'Unavailable' } });
  });
  await page.goto(`/read/mal-manga-21/1?chapter=${md}&source=mangadex`);
  const retry = page.getByRole('button', { name: 'Retry page 1', exact: true });
  await expect(retry).toBeVisible({ timeout: 15000 });
  expect(attempts).toBe(4);
  available = true;
  await retry.click();
  await expect(page.locator('[data-page="1"]')).toHaveClass(/ready/);
  expect(attempts).toBe(5);
});

test('site catalog defaults drive chapter sources and guest overrides reset', async ({
  page,
  context,
  baseURL,
}, testInfo) => {
  await setup(page, context, baseURL);
  await page.route('**/api/reader/catalogs', (route) =>
    route.fulfill({
      json: {
        sources: [
          { id: '1', name: 'MangaDex', language: 'en' },
          { id: '2', name: 'Weeb Central', language: 'en' },
          { id: '3', name: 'NineHentai', language: 'en' },
          { id: '4', name: 'Aunt Manhwa', language: 'en' },
        ],
      },
    }),
  );
  await page.goto('/settings');
  const card = page.locator('.reader-connection');
  await expect(
    card.getByRole('switch', { name: 'NineHentai in Yoru', exact: true }),
  ).toHaveAttribute('aria-checked', 'false');
  await expect(
    card.getByRole('switch', { name: 'NineHentai in Ara Ara', exact: true }),
  ).toHaveAttribute('aria-checked', 'true');
  await expect(
    card.getByRole('switch', { name: 'Aunt Manhwa in Ara Ara', exact: true }),
  ).toHaveAttribute('aria-checked', 'true');
  await card.getByRole('switch', { name: 'Weeb Central in Yoru', exact: true }).click();
  await expect(
    card.getByRole('switch', { name: 'Weeb Central in Yoru', exact: true }),
  ).toHaveAttribute('aria-checked', 'false');
  await page.goto('/title/mal-manga-21');
  await expect(page.getByRole('link', { name: /MangaDex edition/ }).first()).toBeVisible();
  await expect(page.getByRole('link', { name: /Suwayomi edition/ })).toHaveCount(0);
  await page.goto('/settings');
  await card.getByRole('button', { name: 'Reset to site defaults' }).click();
  await expect(
    card.getByRole('switch', { name: 'Weeb Central in Yoru', exact: true }),
  ).toHaveAttribute('aria-checked', 'true');
  await card.screenshot({ path: testInfo.outputPath('catalog-shared-defaults.png') });
  await page.goto('/title/mal-manga-21');
  await expect(page.getByRole('link', { name: /Suwayomi edition/ }).first()).toBeVisible();
});

test('live source switching retains the old edition until an exact target is chosen', async ({
  page,
  context,
  baseURL,
}) => {
  await setup(page, context, baseURL);
  await page.goto('/read/mal-manga-21/1');
  await expectEdition(page, sw);
  await expect(page.locator('.reader-canvas')).toHaveAttribute('data-mode', 'single');
  const controls = await menu(page);
  await expect(controls.getByLabel('Page direction', { exact: true })).toHaveValue('rtl');
  await controls.getByLabel('Page number', { exact: true }).selectOption('2');
  const originalURL = page.url();
  let release;
  const paused = new Promise((resolve) => {
    release = resolve;
  });
  await page.route(new RegExp(`/api/media/mal-manga-21/reader/${md}(?:\\?.*)?$`), async (route) => {
    assertContext(route.request());
    await paused;
    await route.fulfill({
      json: {
        id: md,
        kind: 'remote',
        number: '1',
        language: 'en',
        title: 'MangaDex edition',
        group: 'MD group',
        pages: [0, 1, 2].map((i) => ({ url: `/api/media/mal-manga-21/reader/${md}/page/${i}` })),
      },
    });
  });
  await controls.getByLabel('Reading source', { exact: true }).selectOption('mangadex');
  await expectEdition(page, sw);
  expect(page.url()).toBe(originalURL);
  await expect(controls.getByLabel('Page number', { exact: true })).toHaveValue('2');
  await page
    .getByRole('dialog', { name: 'Choose an exact edition', exact: true })
    .getByRole('button', { name: /Read chapter 1/ })
    .click();
  await expect(page.locator('.reader-canvas')).toHaveCount(0);
  release();
  const mobile = page.getByRole('dialog', { name: 'Reader menu', exact: true });
  if (await mobile.isVisible())
    await mobile.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await expectEdition(page, md);
  const nextControls = await menu(page);
  await nextControls.getByLabel('Page number', { exact: true }).selectOption('2');
  const saved = await page.evaluate(
    () => JSON.parse(localStorage.getItem('yoru:reader:state:mal-manga-21')).chapters,
  );
  expect(saved[sw].page).toBe(2);
  expect(saved[md].page).toBe(2);
  await page.reload();
  await expect(page.getByRole('img', { name: 'Chapter 1, page 2', exact: true })).toBeVisible();
  await expect((await menu(page)).getByLabel('Reading source', { exact: true })).toHaveValue(
    'mangadex',
  );
});

test('explicit remote sources never fall back to imported pages during an outage', async ({
  page,
  context,
  baseURL,
}) => {
  await setup(page, context, baseURL);
  await page.route(/\/api\/media\/[^/]+\/reading-sources(?:\?.*)?$/, (route) =>
    route.fulfill({ json: { state: 'offline', sources: [] } }),
  );
  await page.goto('/read/mal-manga-21/1?source=weebcentral');
  await expect(
    page.getByText('The reading server is offline. Try again shortly.', { exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Add chapters', exact: true }).click();
  await page.getByLabel('Chapter manifest').setInputFiles({
    name: 'local.json',
    mimeType: 'application/json',
    buffer: Buffer.from(
      JSON.stringify({
        chapters: {
          1: {
            language: 'en',
            groups: { 'Local edition': ['https://images.example.org/test-local-page.png'] },
          },
        },
      }),
    ),
  });
  await page.getByRole('button', { name: 'Import chapters', exact: true }).click();
  await expect(page.locator('.reader-canvas')).toBeVisible();
  await page.goto('/read/mal-manga-21/1?source=weebcentral');
  await expect(page.locator('.reader-canvas')).toHaveCount(0);
  await expect(
    page.getByText('The reading server is offline. Try again shortly.', { exact: true }),
  ).toBeVisible();
  await page.getByLabel('Reading source', { exact: true }).selectOption('local');
  await page
    .getByRole('dialog', { name: 'Choose an exact edition', exact: true })
    .getByRole('button', { name: /Read chapter 1/ })
    .click();
  await expect(page.locator('.reader-canvas')).toBeVisible();
});

test('remote translation choices fetch the selected language and retain chapter progress without a page URL', async ({
  page,
  context,
  baseURL,
}) => {
  await setup(page, context, baseURL);
  await page.goto('/read/mal-manga-21/1?source=mangadex');
  await expectEdition(page, md);
  await (await menu(page)).getByLabel('Page number', { exact: true }).selectOption('2');
  await (await menu(page)).getByRole('button', { name: 'Chapters', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Chapters', exact: true });
  await expect(dialog.getByLabel('Chapter language')).toHaveValue('en');
  await expect(dialog.getByText('Available from this source', { exact: true })).toBeVisible();
  await dialog.getByLabel('Chapter language').selectOption('es');
  await expectEdition(page, md);
  expect(new URL(page.url()).searchParams.get('page')).toBe('2');
  expect(new URL(page.url()).searchParams.get('chapter')).not.toBe(es);
  await dialog.getByRole('button', { name: /Read chapter 2/ }).click();
  await expectEdition(page, es);
  await (await menu(page)).getByLabel('Page number', { exact: true }).selectOption('2');
  await page.goto(`/read/mal-manga-21/2?chapter=${es}&language=es`);
  await expect(page.getByRole('img', { name: 'Chapter 2, page 2', exact: true })).toBeVisible();
  const saved = await page.evaluate(
    () => JSON.parse(localStorage.getItem('yoru:reader:state:mal-manga-21')).chapters,
  );
  expect(saved[md].page).toBe(2);
  expect(saved[es].page).toBe(2);
});

test('chapter directory reports partial source discovery and can retry it', async ({
  page,
  context,
  baseURL,
}) => {
  await setup(page, context, baseURL);
  let requests = 0;
  await page.route(/\/api\/media\/[^/]+\/reading-sources(?:\?.*)?$/, (route) =>
    route.fulfill({
      json:
        ++requests === 1
          ? { state: 'ready', partial: true, sources: [{ id: 'mangadex', name: 'MangaDex' }] }
          : {
              state: 'ready',
              sources: [
                { id: 'mangadex', name: 'MangaDex' },
                { id: 'weebcentral', name: 'Weeb Central' },
              ],
            },
    }),
  );
  await page.goto('/title/mal-manga-21');
  const catalog = page.getByRole('region', { name: 'Live chapter catalog' });
  await expect(
    catalog.getByText('Some reading sources are temporarily unavailable.', { exact: true }),
  ).toBeVisible();
  await catalog.getByRole('button', { name: 'Retry sources', exact: true }).click();
  await expect(catalog.getByLabel('Chapter source')).toHaveValue('weebcentral');
  await expect(catalog.getByRole('button', { name: 'Retry sources', exact: true })).toHaveCount(0);
});

test('a disabled saved source stays disabled during an outage and a direct link offers an enabled alternative', async ({
  page,
  context,
  baseURL,
}) => {
  await setup(page, context, baseURL);
  await page.addInitScript(() => {
    localStorage.setItem(
      'yoru:catalog-overrides:guest:v1',
      JSON.stringify({ 'Weeb Central': { yoru: false } }),
    );
    localStorage.setItem('yoru:reading-source:mal-manga-21', 'weebcentral');
  });
  await page.route(/\/api\/media\/[^/]+\/reading-sources(?:\?.*)?$/, (route) =>
    route.fulfill({
      json: { state: 'ready', partial: true, sources: [{ id: 'mangadex', name: 'MangaDex' }] },
    }),
  );
  await page.goto('/title/mal-manga-21');
  await expect(page.getByRole('link', { name: /MangaDex edition/ }).first()).toBeVisible();
  await expect(
    page
      .getByLabel('Chapter source', { exact: true })
      .getByRole('option', { name: /Weeb Central/ }),
  ).toHaveCount(0);
  await page.goto(`/read/mal-manga-21/1?chapter=${sw}`);
  await expect(
    page.getByText(
      'This chapter source is disabled for this section. Choose another source or change Reader catalogs in Settings.',
      { exact: true },
    ),
  ).toBeVisible();
  await expect(page.locator('.reader-canvas')).toHaveCount(0);
  const controls = await menu(page);
  await controls.getByLabel('Reading source', { exact: true }).selectOption('mangadex');
  expect(new URL(page.url()).searchParams.get('chapter')).toBe(sw);
  await page
    .getByRole('dialog', { name: 'Choose an exact edition', exact: true })
    .getByRole('button', { name: /Read chapter 1/ })
    .click();
  await expect(page.locator('.reader-canvas')).toBeVisible();
});

test('live manhwa opens vertically and an offline server preserves access to local imports', async ({
  page,
  context,
  baseURL,
}) => {
  await setup(page, context, baseURL);
  await page.goto(`/read/mal-manga-121496/1?chapter=${sw}`);
  await expect(page.locator('.reader-canvas')).toHaveAttribute('data-mode', 'webtoon');
  await expect(page.getByRole('img', { name: 'Chapter 1, page 1', exact: true })).toBeVisible();
  await page.route(/\/api\/media\/[^/]+\/reading-sources(?:\?.*)?$/, (route) =>
    route.fulfill({ json: { state: 'offline', sources: [{ id: 'mangadex', name: 'MangaDex' }] } }),
  );
  // An exact chapter can still open when discovery alone is down; a full outage also fails its manifest.
  await page.route(new RegExp(`/api/media/[^/]+/reader/${sw}(?:\\?.*)?$`), (route) =>
    route.fulfill({
      status: 503,
      json: { error: 'The reading server is offline. Try again shortly.' },
    }),
  );
  await page.reload();
  await expect(
    page.getByText('The reading server is offline. Try again shortly.', { exact: true }),
  ).toBeVisible();
  await expect(page.locator('.reader-canvas')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Add chapters', exact: true })).toBeVisible();
});
