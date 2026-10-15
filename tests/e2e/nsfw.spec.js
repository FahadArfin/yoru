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
  await expect(page.getByRole('heading', { name: 'Adult manhwa', exact: true })).toBeVisible();
  await expect(page.getByText('Catalog not connected', { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Adult manhwa', exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Hentai manga', exact: true }).click();
  await expect(page).toHaveURL(/\/nsfw\/manga$/);
  await expect(page.getByRole('heading', { name: 'Hentai manga', exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Hentai anime', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Hentai anime', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  expect(catalogRequests).toEqual([]);
  await page.getByRole('button', { name: 'Leave this section' }).click();
  await expect(page).toHaveURL(/\/$/);
  await page.goto('/nsfw/anime');
  await expect(page.getByRole('heading', { name: 'Adults only', exact: true })).toBeVisible();
});

test('NSFW navigation opens from the top bar or mobile navigation', async ({ page, isMobile }) => {
  await page.goto('/browse/anime');
  if (isMobile) {
    await page.getByRole('button', { name: 'Open navigation' }).click();
    await page
      .getByRole('dialog', { name: 'Navigation' })
      .getByRole('link', { name: /NSFW/ })
      .click();
  } else {
    const menu = page.getByRole('button', { name: 'NSFW menu' });
    await menu.click();
    const dropdown = page.getByRole('navigation', { name: 'NSFW categories' });
    await expect(dropdown.getByRole('link')).toHaveCount(3);
    await page.keyboard.press('Escape');
    await expect(menu).toBeFocused();
    await expect(dropdown).toHaveCount(0);
    await menu.press('ArrowDown');
    await expect(page.getByRole('link', { name: 'Hentai anime', exact: true })).toBeFocused();
    await page.getByRole('link', { name: 'Adult manhwa', exact: true }).click();
  }
  await expect(page.getByRole('heading', { name: 'Adults only', exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Back to Yoru', exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
});
