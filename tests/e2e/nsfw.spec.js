import { navigateCollection } from './navigation';
import { test, expect } from '@playwright/test';
test.beforeEach(async ({ context, baseURL }) => {
  await context.route('**/*', (route) =>
    new URL(route.request().url()).origin === baseURL ? route.continue() : route.abort(),
  );
});
test('age gate protects deep links and header search, and leaving resets confirmation', async ({
  page,
}) => {
  const requests = [];
  page.on('request', (r) => {
    if (r.url().includes('/api/ara-ara/catalog')) requests.push(r.url());
  });
  await page.goto('/nsfw/manhwa');
  await expect(page.getByRole('heading', { name: 'Adults only', exact: true })).toBeVisible();
  await expect(
    page.getByRole('combobox', { name: 'Search anime, manga, and manhwa' }),
  ).toBeDisabled();
  expect(requests).toEqual([]);
  await page.getByRole('button', { name: 'I’m 18 or older' }).click();
  await expect(page.getByRole('tab', { name: 'New series', exact: true })).toBeVisible();
  await expect(page.locator('.compact-category-page')).toBeVisible();
  await page.reload();
  await expect(page.getByRole('tab', { name: 'New series', exact: true })).toBeVisible();

  await navigateCollection(page, 'Manga', true);
  await expect(page).toHaveURL(/ara-ara\/manga$/);
  await expect(page.getByRole('region', { name: 'Featured manga' })).toBeVisible();
  await navigateCollection(page, 'Anime', true);
  await expect(
    page
      .getByRole('region', { name: 'Featured anime' })
      .getByRole('heading', { name: 'Vinland Saga', exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('tab', { name: 'New series', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  await navigateCollection(page, 'Back to Yoru', true);
  await expect(page).toHaveURL(/\/$/);
  await navigateCollection(page, 'NSFW · Ara Ara, 18+');
  await expect(page.getByRole('heading', { name: 'Adults only', exact: true })).toBeVisible();
});

test('confirmation remains usable when session storage is unavailable', async ({ page }) => {
  await page.addInitScript(() => {
    Storage.prototype.getItem = () => {
      throw new Error('Storage unavailable');
    };
    Storage.prototype.setItem = Storage.prototype.removeItem = () => {
      throw new Error('Storage unavailable');
    };
  });
  await page.goto('/ara-ara/manhwa');
  await page.getByRole('button', { name: 'I’m 18 or older' }).click();
  await expect(page.getByRole('tab', { name: 'New series', exact: true })).toBeVisible();
  await navigateCollection(page, 'Back to Yoru', true);
  await navigateCollection(page, 'NSFW · Ara Ara, 18+');
  await expect(page.getByRole('heading', { name: 'Adults only', exact: true })).toBeVisible();
});
