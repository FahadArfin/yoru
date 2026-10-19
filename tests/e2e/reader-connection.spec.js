import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';

test('account catalog choices follow a fresh browser while guest choices remain separate', async ({
  page,
  context,
  browser,
  baseURL,
}) => {
  const sources = [{ id: '1', name: 'Weeb Central', language: 'en' }];
  await page.route('**/api/reader/catalogs', (route) => route.fulfill({ json: { sources } }));
  const credentials = {
    name: 'Catalog reader',
    email: `${randomUUID()}@example.test`,
    password: 'Catalog sync testing 2026',
  };
  expect(
    (
      await context.request.post('/api/auth/register', {
        headers: { Origin: baseURL },
        data: credentials,
      })
    ).status(),
  ).toBe(201);
  await page.goto('/settings');
  const toggle = page.getByRole('switch', { name: 'Weeb Central in Yoru', exact: true });
  await expect(toggle).toHaveAttribute('aria-checked', 'true');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-checked', 'false');
  const second = await browser.newContext({ baseURL });
  try {
    await second.route('**/api/reader/catalogs', (route) => route.fulfill({ json: { sources } }));
    expect(
      (
        await second.request.post('/api/auth/login', {
          headers: { Origin: baseURL },
          data: credentials,
        })
      ).status(),
    ).toBe(200);
    const fresh = await second.newPage();
    await fresh.goto('/settings');
    await expect(
      fresh.getByRole('switch', { name: 'Weeb Central in Yoru', exact: true }),
    ).toHaveAttribute('aria-checked', 'false');
    await fresh.getByRole('button', { name: 'Reset to site defaults' }).click();
    await expect(
      fresh.getByRole('switch', { name: 'Weeb Central in Yoru', exact: true }),
    ).toHaveAttribute('aria-checked', 'true');
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect(toggle).toHaveAttribute('aria-checked', 'true');
    await second.request.post('/api/auth/logout', { headers: { Origin: baseURL }, data: {} });
    await fresh.reload();
    await expect(
      fresh.getByRole('switch', { name: 'Weeb Central in Yoru', exact: true }),
    ).toHaveAttribute('aria-checked', 'true');
  } finally {
    await second.close();
  }
});

test.beforeEach(async ({ context, page, baseURL }) => {
  await context.route('**/*', (route) =>
    new URL(route.request().url()).origin === baseURL ? route.continue() : route.abort(),
  );
  await page.route('**/api/config', (route) =>
    route.fulfill({ json: { realtime: {}, auth: { discord: false } } }),
  );
  await page.route('**/api/reader/catalogs', (route) => route.fulfill({ json: { sources: [] } }));
});

test('provider and language filters combine, survive refresh and clear without losing catalogs', async ({
  page,
}, testInfo) => {
  await page.route('**/api/reader/catalogs', (route) =>
    route.fulfill({
      json: {
        sources: [
          { id: '1', name: 'Cubari', language: 'en' },
          { id: '2', name: 'Cubari', language: 'all' },
          { id: '3', name: 'Webcomics', language: 'en' },
          { id: '4', name: 'Webcomics', language: 'fr' },
        ],
      },
    }),
  );
  await page.goto('/settings');
  const card = page.locator('.reader-connection');
  const list = card.getByRole('region', { name: 'Installed reader catalogs' });
  await card.getByLabel('Filter providers').fill('  WEB  ');
  await card.getByLabel('Catalog language').selectOption('fr');
  await expect(list).toContainText('Webcomics');
  await expect(list).not.toContainText('Cubari');
  await expect(card.getByText('1 of 4 catalogs')).toBeVisible();
  await card.getByRole('button', { name: 'Refresh connection' }).click();
  await expect(card.getByText('1 of 4 catalogs')).toBeVisible();
  await card.getByLabel('Catalog language').selectOption('all');
  await expect(card.getByText('No catalogs match your filters.')).toBeVisible();
  await card.getByRole('button', { name: 'Clear filters' }).click();
  await expect(list).toContainText('Cubari');
  await expect(list).toContainText('Webcomics');
  await expect(card.getByText('4 of 4 catalogs')).toBeVisible();
  const cubari = card.getByRole('switch', { name: 'Cubari in Yoru', exact: true });
  await cubari.click();
  await expect(cubari).toHaveAttribute('aria-checked', 'false');
  await card.getByLabel('Catalog status').selectOption('on');
  await expect(list).not.toContainText('Cubari');
  await card.getByLabel('Catalog status').selectOption('off');
  await expect(list).toContainText('Cubari');
  await expect(list).not.toContainText('Webcomics');
  await page.reload();
  await expect(cubari).toHaveAttribute('aria-checked', 'false');
  await cubari.click();
  await expect(cubari).toHaveAttribute('aria-checked', 'true');
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  await card.screenshot({ path: testInfo.outputPath('catalog-filters.png') });
});

test('Yoru and Ara Ara list switches are independent and retain existing browser choices', async ({
  page,
}, testInfo) => {
  await page.addInitScript(() => {
    if (!localStorage.getItem('yoru:reader-catalogs:v1')) {
      localStorage.setItem(
        'yoru:reader-catalogs:v1',
        JSON.stringify({
          url: 'https://reader.example',
          enabled: {
            yoru: { 1: false, 2: false, 3: true },
            'https://reader.example': { 9: false },
          },
        }),
      );
    }
  });
  await page.route('**/api/reader/catalogs', (route) =>
    route.fulfill({
      json: {
        sources: [
          { id: '1', name: 'Cubari', language: 'en' },
          { id: '2', name: 'Cubari', language: 'all' },
          { id: '3', name: 'Webcomics', language: 'en' },
        ],
      },
    }),
  );
  await page.goto('/settings');
  const card = page.locator('.reader-connection');
  const yoru = card.getByRole('switch', { name: 'Cubari in Yoru', exact: true });
  const ara = card.getByRole('switch', { name: 'Cubari in Ara Ara', exact: true });
  await expect(yoru).toHaveAttribute('aria-checked', 'false');
  await expect(ara).toHaveAttribute('aria-checked', 'false');
  await ara.click();
  await expect(yoru).toHaveAttribute('aria-checked', 'false');
  await expect(ara).toHaveAttribute('aria-checked', 'true');
  await card.getByLabel('Source list').selectOption('ara-ara');
  await card.getByLabel('Catalog status').selectOption('on');
  await expect(card.getByText('2 of 3 catalogs')).toBeVisible();
  await expect(card.getByRole('region', { name: 'Installed reader catalogs' })).not.toContainText(
    'Webcomics',
  );
  await card.getByLabel('Source list').selectOption('yoru');
  await expect(card.getByRole('region', { name: 'Installed reader catalogs' })).not.toContainText(
    'Cubari',
  );
  await card.getByRole('button', { name: 'Clear filters' }).click();
  await yoru.click();
  await page.reload();
  await expect(yoru).toHaveAttribute('aria-checked', 'true');
  await expect(ara).toHaveAttribute('aria-checked', 'true');
  await ara.click();
  await expect(yoru).toHaveAttribute('aria-checked', 'true');
  const preferences = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('yoru:reader-catalogs:v1')),
  );
  expect(preferences.url).toBe('https://reader.example');
  expect(preferences.enabled['https://reader.example']['9']).toBe(false);
  const overrides = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('yoru:catalog-overrides:guest:v1')),
  );
  expect(overrides.Cubari.yoru).toBe(true);
  expect(overrides.Cubari['ara-ara']).toBe(false);
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  await card.screenshot({ path: testInfo.outputPath('catalog-destinations.png') });
  await page.goto('/ara-ara/settings');
  await page.getByRole('button', { name: 'I’m 18 or older' }).click();
  await expect(card.getByLabel('Source list')).toHaveValue('ara-ara');
  await card.getByLabel('Catalog status').selectOption('on');
  await expect(card.getByText('No catalogs match your filters.')).toBeVisible();
  await card.getByLabel('Source list').selectOption('yoru');
  await expect(card.getByText('3 of 3 catalogs')).toBeVisible();
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
  await expect(card.getByRole('status')).toContainText('Connected · No online catalogs installed.');
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
  await expect(card.getByRole('status')).toContainText('2 installed catalogs');
  await expect(card.getByLabel('Suwayomi server address')).toHaveValue('https://reader.example');
  await expect(card.getByText('Excluded', { exact: true })).toBeVisible();
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
