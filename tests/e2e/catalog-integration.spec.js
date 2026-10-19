import { test, expect } from '@playwright/test';
import { navigateCollection } from './navigation';

test.beforeEach(async ({ context, page, baseURL }) => {
  await context.route('**/*', (route) =>
    new URL(route.request().url()).origin === baseURL ? route.continue() : route.abort(),
  );
  await page.route('**/api/config', (route) =>
    route.fulfill({ json: { realtime: {}, auth: { discord: false } } }),
  );
  await page.route('**/api/reader/catalogs', (route) => route.fulfill({ json: { sources: [] } }));
});

test('integration choices sync without bypassing Ara confirmation', async ({ page }) => {
  const content = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (
      url.pathname.startsWith('/api/ara-ara/') ||
      (url.searchParams.get('destination') === 'ara-ara' &&
        /\/(discovery|browse|suggestions|media|chapters|reader|page|cover)(\/|$)/.test(
          url.pathname,
        ))
    )
      content.push(url.href);
  });
  await page.goto('/settings');
  const card = page.locator('.reader-connection');
  const integration = card.getByRole('combobox', { name: 'Catalog integration', exact: true });
  await expect(integration).toBeEnabled();
  expect(await integration.locator('option').allTextContents()).toEqual([
    'All sources',
    'MangaDex + Weeb Central',
    'Suwayomi extensions',
  ]);
  await integration.selectOption('core');
  await expect(integration).toHaveValue('core');
  await card.getByRole('combobox', { name: 'Source list', exact: true }).selectOption('ara-ara');
  await expect(integration).toHaveValue('all');
  await integration.selectOption('core');
  await expect(
    card.getByText(
      'MangaDex and Weeb Central are disabled in Ara Ara with your current memberships.',
      { exact: false },
    ),
  ).toBeVisible();
  await integration.selectOption('extensions');
  await expect(integration).toHaveValue('extensions');
  await card.getByRole('combobox', { name: 'Source list', exact: true }).selectOption('yoru');
  await expect(integration).toHaveValue('core');
  await page.goto('/ara-ara/manga');
  await expect(page.getByRole('heading', { name: 'Adults only', exact: true })).toBeVisible();
  expect(content).toEqual([]);
  await page.getByRole('button', { name: 'I’m 18 or older' }).click();
  await expect(page.getByRole('heading', { name: 'Adults only', exact: true })).toHaveCount(0);
  await navigateCollection(page, 'Back to Yoru', true);
  const confirmedContentCount = content.length;
  await page.goto('/ara-ara/manga');
  await expect(page.getByRole('heading', { name: 'Adults only', exact: true })).toBeVisible();
  expect(content).toHaveLength(confirmedContentCount);
  await page.goto('/settings');
  await expect(integration).toHaveValue('core');
  await card.getByRole('button', { name: 'Reset to site defaults' }).click();
  await expect(integration).toHaveValue('all');
  await card.getByRole('combobox', { name: 'Source list', exact: true }).selectOption('ara-ara');
  await expect(integration).toHaveValue('all');
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
});

test('failed identity uses public default selection and keeps preference changes disabled', async ({
  page,
}) => {
  await page.addInitScript(() => {
    localStorage.setItem(
      'yoru:reader-integration-modes:guest:v1',
      JSON.stringify({ yoru: 'extensions', 'ara-ara': 'core' }),
    );
  });
  await page.route('**/api/auth/me', (route) =>
    route.fulfill({ status: 503, json: { error: 'Identity check unavailable' } }),
  );
  await page.goto('/settings');
  const integration = page
    .locator('.reader-connection')
    .getByRole('combobox', { name: 'Catalog integration', exact: true });
  await expect(integration).toHaveValue('all');
  await expect(integration).toBeDisabled();
});

test('account integration modes sync to another browser and stay separate from guest choices', async ({
  page,
  context,
  browser,
  baseURL,
}) => {
  await page.addInitScript(() => {
    localStorage.setItem(
      'yoru:reader-integration-modes:guest:v1',
      JSON.stringify({ yoru: 'extensions', 'ara-ara': 'all' }),
    );
  });
  const credentials = {
    name: 'Integration reader',
    email: `integration-${Date.now()}-${Math.random().toString(16).slice(2)}@example.test`,
    password: 'Integration test password 2026',
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
  const card = page.locator('.reader-connection');
  const selector = card.getByRole('combobox', { name: 'Catalog integration', exact: true });
  await expect(selector).toBeEnabled();
  await expect(selector).toHaveValue('all');
  await selector.selectOption('core');
  await expect(selector).toHaveValue('core');
  await card.getByRole('combobox', { name: 'Source list', exact: true }).selectOption('ara-ara');
  await selector.selectOption('extensions');
  await expect(selector).toHaveValue('extensions');
  const second = await browser.newContext({ baseURL });
  try {
    await second.route('**/*', (route) =>
      new URL(route.request().url()).origin === baseURL ? route.continue() : route.abort(),
    );
    await second.route('**/api/config', (route) =>
      route.fulfill({ json: { realtime: {}, auth: { discord: false } } }),
    );
    await second.route('**/api/reader/catalogs', (route) =>
      route.fulfill({ json: { sources: [] } }),
    );
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
    const freshCard = fresh.locator('.reader-connection');
    const freshSelector = freshCard.getByRole('combobox', {
      name: 'Catalog integration',
      exact: true,
    });
    await expect(freshSelector).toHaveValue('core');
    await freshCard
      .getByRole('combobox', { name: 'Source list', exact: true })
      .selectOption('ara-ara');
    await expect(freshSelector).toHaveValue('extensions');
    await freshCard.getByRole('button', { name: 'Reset to site defaults' }).click();
    await expect(freshSelector).toHaveValue('all');
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect(selector).toHaveValue('all');
  } finally {
    await second.close();
  }
  await context.request.post('/api/auth/logout', { headers: { Origin: baseURL }, data: {} });
  await page.reload();
  await expect(selector).toHaveValue('extensions');
});
