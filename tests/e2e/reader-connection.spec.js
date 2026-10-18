import { test, expect } from '@playwright/test';

test.beforeEach(async ({ context, page, baseURL }) => {
  await context.route('**/*', (route) =>
    new URL(route.request().url()).origin === baseURL ? route.continue() : route.abort(),
  );
  await page.route('**/api/config', (route) =>
    route.fulfill({ json: { realtime: {}, auth: { discord: false } } }),
  );
  await page.route('**/api/reader/catalogs', (route) => route.fulfill({ json: { sources: [] } }));
});

test('default server needs no address and reports connection failure with retry', async ({
  page,
}) => {
  let fail = true;
  await page.route('**/api/reader/catalogs', (route) =>
    route.fulfill(
      fail
        ? { status: 503, json: { error: 'Reader offline. Try again.' } }
        : { json: { sources: [] } },
    ),
  );
  await page.goto('/settings');
  const card = page.locator('.reader-connection');
  await expect(card.getByRole('alert')).toHaveText('Reader offline. Try again.');
  fail = false;
  await card.getByRole('button', { name: 'Refresh connection' }).click();
  await expect(card.getByRole('status')).toContainText(
    'Connected · No supported online catalogs installed.',
  );
  await expect(card.getByLabel('Suwayomi server address')).toHaveCount(0);
});

test('custom server validates addresses, remembers toggles and browses only enabled catalogs', async ({
  page,
}, testInfo) => {
  let queries = 0;
  await page.route('https://reader.example/api/graphql', (route) => {
    const body = route.request().postDataJSON();
    const data = body.query.includes('YoruSources')
      ? {
          sources: {
            nodes: [
              {
                id: '1',
                name: 'Sample Catalog',
                lang: 'en',
                isNsfw: false,
                contentWarning: 'SAFE',
              },
              { id: '2', name: 'Excluded', isNsfw: true, contentWarning: 'NSFW' },
            ],
          },
        }
      : (++queries,
        {
          mangas: {
            nodes: [{ id: 3, sourceId: '1', title: 'A story', genre: [] }],
            pageInfo: { hasNextPage: false },
          },
        });
    return route.fulfill({ headers: { 'access-control-allow-origin': '*' }, json: { data } });
  });
  await page.goto('/settings');
  const card = page.locator('.reader-connection');
  await card.getByRole('button', { name: 'Use another server' }).click();
  await card
    .getByLabel('Suwayomi server address')
    .fill('https://raw.githubusercontent.com/test/index.min.json');
  await card.getByRole('button', { name: 'Connect', exact: true }).click();
  await expect(card.getByRole('alert')).toContainText('extension repository');
  await card.getByLabel('Suwayomi server address').fill('reader.example/api/graphql/');
  await card.getByText('Server sign-in (optional)').click();
  await card.getByLabel('Server username').fill('reader');
  await card.getByLabel('Server password').fill('not-persisted');
  await card.getByRole('button', { name: 'Connect', exact: true }).click();
  await expect(card.getByRole('status')).toContainText('1 supported catalog');
  await expect(card.getByLabel('Suwayomi server address')).toHaveValue('https://reader.example');
  await expect(card.getByText('Excluded', { exact: true })).toHaveCount(0);
  const toggle = card.getByRole('switch', { name: 'Sample Catalog catalog' });
  await toggle.click();
  await expect(card.getByRole('button', { name: 'Browse Sample Catalog' })).toBeDisabled();
  expect(queries).toBe(0);
  expect(await page.evaluate(() => localStorage.getItem('yoru:reader-catalogs:v1'))).not.toContain(
    'not-persisted',
  );
  await page.reload();
  await card.getByRole('button', { name: 'Use another server' }).click();
  await card.getByRole('button', { name: 'Connect', exact: true }).click();
  await expect(toggle).toHaveAttribute('aria-checked', 'false');
  await toggle.click();
  await card.getByRole('button', { name: 'Browse Sample Catalog' }).click();
  await expect(card.getByRole('link', { name: 'Find in Yoru' })).toHaveAttribute(
    'href',
    '/browse/manga?q=A%20story',
  );
  expect(queries).toBe(1);
  await toggle.click();
  await expect(card.getByRole('link', { name: 'Find in Yoru' })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  await card.screenshot({ path: testInfo.outputPath('reader-catalogs.png') });
});
