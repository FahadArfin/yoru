import { test, expect } from '@playwright/test';

test.beforeEach(async ({ context, baseURL }) => {
  await context.route('**/*', (route) =>
    new URL(route.request().url()).origin === baseURL ? route.continue() : route.abort(),
  );
});

test('adult section guards direct category links and can be hidden again', async ({ page }) => {
  const catalogRequests = [];
  page.on('request', (request) => {
    if (request.url().includes('/api/catalog?')) catalogRequests.push(request.url());
  });
  await page.goto('/nsfw/manhwa');
  await expect(page.getByRole('heading', { name: 'Adults only', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Adult manhwa', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'I’m 18 or older' }).click();
  await expect(page.getByRole('heading', { name: 'Ara Ara', exact: true })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Leave this section' })).toBeFocused();
  await expect(page.getByRole('heading', { name: 'Adult manhwa', exact: true })).toBeVisible();
  await expect(page.getByText('Catalog not connected', { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Adult manhwa', exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Adult manga', exact: true }).click();
  await expect(page).toHaveURL(/\/ara-ara\/manga$/);
  await expect(page.getByRole('heading', { name: 'Adult manga', exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Adult anime', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Adult anime', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  expect(catalogRequests).toEqual([]);
  await page.getByRole('button', { name: 'Leave this section' }).click();
  await expect(page).toHaveURL(/\/$/);
  await page.goto('/nsfw/anime');
  await expect(page.getByRole('heading', { name: 'Adults only', exact: true })).toBeVisible();
});

test('NSFW is a direct link into the separately branded Ara Ara area', async ({ page }) => {
  await page.goto('/browse/anime');
  const entry = page.getByRole('link', { name: 'NSFW · Ara Ara, 18+', exact: true });
  await expect(entry).toHaveAttribute('href', '/ara-ara');
  await expect(entry).not.toHaveAttribute('aria-expanded');
  await entry.click();
  await expect(page).toHaveURL(/\/ara-ara$/);
  await expect(page).toHaveTitle('Ara Ara · 18+');
  await expect(page.getByRole('navigation', { name: 'Explore Ara Ara' })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Explore Yoru' })).toHaveCount(0);
  await expect(page.getByRole('combobox', { name: 'Search anime, manga, and manhwa' })).toHaveCount(
    0,
  );
  await expect(page.getByRole('heading', { name: 'Adults only', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'I’m 18 or older' }).click();
  await page
    .getByRole('navigation', { name: 'Explore Ara Ara' })
    .getByRole('link', { name: 'Manga', exact: true })
    .click();
  await expect(page).toHaveURL(/\/ara-ara\/manga$/);
  await expect(page.getByRole('heading', { name: 'Adult manga', exact: true })).toBeVisible();
  await page
    .getByRole('navigation', { name: 'Explore Ara Ara' })
    .getByRole('link', { name: 'Back to Yoru', exact: true })
    .click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page).toHaveTitle('Yoru · A little more obsessed');
  await page.getByRole('link', { name: 'NSFW · Ara Ara, 18+', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Adults only', exact: true })).toBeVisible();
});
