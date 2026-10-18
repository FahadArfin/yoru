import { test, expect } from '@playwright/test';

test.beforeEach(async ({ context, baseURL }) => {
  await context.route('**/*', (route) =>
    new URL(route.request().url()).origin === baseURL ? route.continue() : route.abort(),
  );
});

test('appearance persists across pages and reloads, and synchronizes open tabs', async ({
  page,
  context,
}) => {
  await page.goto('/settings');
  const dark = page.getByRole('button', { name: 'Dark Soft blue charcoal' });
  const light = page.getByRole('button', { name: 'Light Bright and easygoing' });
  await expect(dark).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.home-shell')).toHaveCSS('background-color', 'rgb(24, 28, 38)');
  const other = await context.newPage();
  await other.goto('/settings');
  await expect(other.getByRole('heading', { name: 'Viewing comfort' })).toBeVisible();
  await light.click();
  await expect(light).toHaveAttribute('aria-pressed', 'true');
  await expect(other.getByRole('button', { name: 'Light Bright and easygoing' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  for (const route of [
    '/',
    '/browse/manga',
    '/browse/manhwa',
    '/schedule',
    '/community',
    '/watch/mal-anime-52991/1',
  ]) {
    await page.goto(route);
    await expect(page.locator('.home-shell')).toHaveCSS('background-color', 'rgb(245, 247, 250)');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
      true,
    );
  }
  await expect(page.locator('.watch-stage')).toHaveCSS('background-color', 'rgb(0, 0, 0)');
  await expect(page.locator('.watch-stage :is(.embed-player, .native-player)').first()).toHaveCSS(
    'background-color',
    'rgb(0, 0, 0)',
  );
  await page.goto('/settings');
  await page.reload();
  await expect(light).toHaveAttribute('aria-pressed', 'true');
  await dark.focus();
  await dark.press('Enter');
  await expect(dark).toHaveAttribute('aria-pressed', 'true');
  await expect(other.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.reload();
  await expect(dark).toHaveAttribute('aria-pressed', 'true');
});

test('saved appearance is applied before React loads', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('yoru:theme', 'light'));
  await page.route('**/assets/*.js', (route) => route.abort());
  await page.goto('/settings');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', '#f5f7fa');
  await expect(page.locator('#root')).toBeEmpty();
});

test('appearance still works when browser storage is unavailable', async ({ page }) => {
  await page.addInitScript(() => {
    Storage.prototype.getItem = () => {
      throw new Error('Storage blocked');
    };
    Storage.prototype.setItem = () => {
      throw new Error('Storage blocked');
    };
  });
  await page.goto('/settings');
  await page.getByRole('button', { name: 'Light Bright and easygoing' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.getByRole('button', { name: 'Dark Soft blue charcoal' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
});
