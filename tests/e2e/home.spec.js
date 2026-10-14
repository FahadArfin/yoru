import { test, expect } from '@playwright/test';
test('weekly banner and release feed navigate with exact identity and selected language', async ({
  page,
  context,
  baseURL,
}) => {
  await context.route('**/*', (route) =>
    new URL(route.request().url()).origin === baseURL ? route.continue() : route.abort(),
  );
  const media = (id, title) => ({
    id,
    title,
    cover: '/icon.svg',
    banner: '/icon.svg',
    category: 'ANIME',
    genres: ['Adventure'],
    format: 'TV',
  });
  const one = media('mal-anime-21', 'Weekly One'),
    two = media('mal-anime-52991', 'Weekly Two');
  await page.route('**/api/home?**', (route) => {
    const language = new URL(route.request().url()).searchParams.get('language');
    return route.fulfill({
      json: {
        hot: [one, two],
        state: 'ready',
        releases: [
          {
            id: 'release',
            title: language === 'dub' ? 'Dub release' : 'Sub release',
            route: 'release',
            media: one,
            episode: 5,
            airType: language,
            airingAt: new Date(Date.now() - 3600000).toISOString(),
            cover: '/icon.svg',
          },
        ],
      },
    });
  });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Weekly One', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add to watchlist', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Next featured title' }).click();
  await expect(page.getByRole('heading', { name: 'Weekly Two', exact: true })).toBeVisible();
  const hero = await page.locator('.weekly-hero').boundingBox(),
    feed = await page.locator('.release-section').boundingBox();
  expect(feed.y).toBeGreaterThan(hero.y + hero.height - 1);
  expect(feed.y - hero.y - hero.height).toBeLessThan(85);
  await page.getByRole('button', { name: 'English dub', exact: true }).click();
  await expect(page.getByRole('link', { name: /Dub release/ })).toHaveAttribute(
    'href',
    '/watch/mal-anime-21/5?language=dub',
  );
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  await page.getByRole('button', { name: 'Open navigation', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Navigation' })).toBeVisible();
  await page.getByRole('dialog').getByRole('link', { name: 'Schedule', exact: true }).click();
  await expect(page).toHaveURL(/\/schedule$/);
});
