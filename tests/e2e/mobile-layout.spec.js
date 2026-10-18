import { test, expect } from '@playwright/test';
import { navigateCollection } from './navigation';

test.beforeEach(async ({ context, baseURL }) => {
  await context.route('**/*', (route) =>
    new URL(route.request().url()).origin === baseURL ? route.continue() : route.abort(),
  );
});

test('phone destinations, search and bottom sheet remain usable at small widths', async ({
  page,
  isMobile,
}) => {
  test.skip(!isMobile, 'Phone interaction coverage');
  test.setTimeout(60000);
  for (const width of [320, 390, 430, 760]) {
    await page.setViewportSize({ width, height: 844 });
    for (const path of [
      '/',
      '/browse/anime?view=all',
      '/schedule',
      '/community',
      '/library',
      '/rooms',
      '/settings',
      '/title/mal-anime-16498',
      '/watch/mal-anime-16498/1',
    ]) {
      await page.goto(path);
      const nav = page.getByRole('navigation', { name: 'Phone navigation' });
      await expect(nav).toBeVisible();
      await expect(page.getByRole('navigation', { name: 'Explore Yoru' })).toBeHidden();
      await expect
        .soft(page.locator('html'), `${width}px ${path} must not overflow`)
        .toHaveJSProperty('scrollWidth', width);
      for (const box of await nav
        .locator('a, button')
        .evaluateAll((els) =>
          els.map((el) => ({ width: el.clientWidth, height: el.clientHeight })),
        )) {
        expect(box.width).toBeGreaterThanOrEqual(44);
        expect(box.height).toBeGreaterThanOrEqual(44);
      }
      const search = page.getByRole('combobox', { name: 'Search anime, manga, and manhwa' });
      expect(await search.evaluate((el) => getComputedStyle(el).fontSize)).toBe('16px');
    }
  }
  const browse = page
    .getByRole('navigation', { name: 'Phone navigation' })
    .getByRole('button', { name: 'Browse' });
  await browse.click();
  await expect(page.getByRole('dialog', { name: 'Browse collections' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(browse).toBeFocused();
  await navigateCollection(page, 'Manga');
  await expect(page).toHaveURL(/\/browse\/manga$/);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await browse.click();
  await page.setViewportSize({ width: 1280, height: 800 });
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('navigation', { name: 'Phone navigation' })).toHaveCount(0);
  await expect(page.getByRole('navigation', { name: 'Explore Yoru' })).toBeVisible();
  expect(await page.locator('body').evaluate((el) => getComputedStyle(el).overflow)).not.toBe(
    'hidden',
  );
});

test('phone search aligns with its full-width field and results can be tapped', async ({
  page,
  isMobile,
}) => {
  test.skip(!isMobile, 'Phone interaction coverage');
  await page.setViewportSize({ width: 320, height: 740 });
  await page.route('**/api/search/suggestions?**', (route) =>
    route.fulfill({
      json: {
        items: [
          {
            id: 'mal-anime-16498',
            title: 'Attack on Titan',
            category: 'ANIME',
            cover: '/icon.svg',
          },
        ],
      },
    }),
  );
  await page.goto('/');
  await page.getByRole('combobox').fill('attack');
  const result = page.getByRole('option').first();
  await expect(result).toContainText('Attack on Titan');
  const field = await page.locator('.global-search').boundingBox();
  const panel = await page.locator('.search-panel').boundingBox();
  expect(Math.abs(panel.x - field.x)).toBeLessThan(2);
  expect(panel.x + panel.width).toBeLessThanOrEqual(320);
  expect(field.width).toBeGreaterThan(250);
  await result.click();
  await expect(page).toHaveURL(/\/title\/mal-anime-16498$/);
});

test('phone calendar reveals selected dates without moving the page and reader stays immersive', async ({
  page,
  isMobile,
}) => {
  test.skip(!isMobile, 'Phone interaction coverage');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/schedule');
  const days = page.locator('.schedule-days');
  await expect(days.locator('[aria-pressed="true"]')).toBeVisible();
  const selectedFits = () =>
    days.evaluate((el) => {
      const b = el.getBoundingClientRect();
      const s = el.querySelector('[aria-pressed="true"]').getBoundingClientRect();
      return s.left >= b.left - 1 && s.right <= b.right + 1 && s.width >= 64;
    });
  expect(await selectedFits()).toBe(true);
  await days.getByRole('button').first().click();
  expect(await selectedFits()).toBe(true);
  const scroll = await page.evaluate(() => scrollY);
  await page.getByRole('button', { name: 'Today', exact: true }).click();
  expect(await selectedFits()).toBe(true);
  expect(Math.abs((await page.evaluate(() => scrollY)) - scroll)).toBeLessThan(2);
  await page.goto('/read/mal-manga-21/1');
  await expect(page.locator('.comic-reader')).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Phone navigation' })).toHaveCount(0);
});

test('desktop does not mount phone navigation or apply phone sizing', async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile, 'Desktop protection');
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await expect(page.getByRole('navigation', { name: 'Phone navigation' })).toHaveCount(0);
  await expect(page.getByRole('navigation', { name: 'Explore Yoru' })).toBeVisible();
  expect(
    await page.locator('.global-search').evaluate((el) => el.getBoundingClientRect().width),
  ).toBeLessThan(500);
  expect(
    await page.locator('.home-shell').evaluate((el) => getComputedStyle(el).paddingBottom),
  ).toBe('0px');
});
