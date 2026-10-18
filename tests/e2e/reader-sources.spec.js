import { test, expect } from '@playwright/test';
import { readerImage } from '../fixtures/reader-image.mjs';

const md = '11111111-2222-4333-8444-555555555555';
const sw = 'sw-weebcentral-8-90';
const pixel = readerImage();
async function setup(page, context, baseURL) {
  await context.route('**/*', (route) =>
    new URL(route.request().url()).origin === baseURL ? route.continue() : route.abort(),
  );
  await page.route('**/api/media/*/reading-sources', (route) =>
    route.fulfill({
      json: {
        state: 'ready',
        sources: [
          { id: 'mangadex', name: 'MangaDex' },
          { id: 'weebcentral', name: 'Weeb Central' },
        ],
      },
    }),
  );
  await page.route('**/api/media/*/chapters?*', (route) => {
    const query = new URL(route.request().url()).searchParams;
    const source = query.get('source');
    return route.fulfill({
      json: {
        state: 'ready',
        items: [
          {
            id: source === 'mangadex' ? md : sw,
            number: '1',
            title: source === 'mangadex' ? 'MangaDex edition' : 'Suwayomi edition',
            language: query.get('language') || 'en',
            groups: [],
            native: true,
            pages: 3,
            source,
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
  await page.route(/\/api\/media\/[^/]+\/reader\/[^/?]+$/, (route) => {
    const url = new URL(route.request().url());
    const id = url.pathname.split('/').at(-1);
    return route.fulfill({
      json: {
        id,
        kind: 'remote',
        number: '1',
        title: id === md ? 'MangaDex edition' : 'Suwayomi edition',
        language: 'en',
        group: id === md ? 'MD group' : 'SW group',
        pages: [0, 1, 2].map((i) => ({ url: `${url.pathname}/page/${i}` })),
      },
    });
  });
}
async function menu(page) {
  if (await page.getByRole('complementary', { name: 'Reader menu' }).isVisible())
    return page.getByRole('complementary', { name: 'Reader menu' });
  const reveal = page.getByRole('button', { name: 'Show chapter and page controls', exact: true });
  if (await reveal.isVisible()) await reveal.click();
  await page.getByRole('button', { name: 'Reader menu', exact: true }).click();
  return page.getByRole('dialog', { name: 'Reader menu', exact: true });
}

test('live sources open native pages and switching clears the old edition while the new one loads', async ({
  page,
  context,
  baseURL,
}) => {
  await setup(page, context, baseURL);
  await page.goto('/read/mal-manga-21/1');
  await expect(page.locator('.reader-canvas img').first()).toHaveAttribute('src', new RegExp(sw));
  await expect(page.locator('.reader-canvas')).toHaveAttribute('data-mode', 'single');
  const controls = await menu(page);
  await expect(controls.getByLabel('Page direction', { exact: true })).toHaveValue('rtl');
  let release;
  const paused = new Promise((resolve) => {
    release = resolve;
  });
  await page.route(`**/api/media/mal-manga-21/reader/${md}`, async (route) => {
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
  await expect(page.locator('.reader-canvas')).toHaveCount(0);
  release();
  const mobile = page.getByRole('dialog', { name: 'Reader menu', exact: true });
  if (await mobile.isVisible())
    await mobile.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await expect(page.locator('.reader-canvas img').first()).toHaveAttribute('src', new RegExp(md));
  const nextControls = await menu(page);
  await nextControls.getByLabel('Page number', { exact: true }).selectOption('2');
  await page.reload();
  await expect(page.getByRole('img', { name: 'Chapter 1, page 2', exact: true })).toBeVisible();
  await expect((await menu(page)).getByLabel('Reading source', { exact: true })).toHaveValue(
    'mangadex',
  );
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
  await page.route('**/api/media/*/reading-sources', (route) =>
    route.fulfill({ json: { state: 'offline', sources: [{ id: 'mangadex', name: 'MangaDex' }] } }),
  );
  await page.reload();
  await expect(
    page.getByText('The reading server is offline. Try again shortly.', { exact: true }),
  ).toBeVisible();
  await expect(page.locator('.reader-canvas')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Add chapters', exact: true })).toBeVisible();
});
