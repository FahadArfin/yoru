import { test, expect } from '@playwright/test';
test.use({ timezoneId: 'America/New_York' });
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
            airingAt: new Date(today.getTime() - 3600000).toISOString(),
            cover: '/icon.svg',
          },
        ],
      },
    });
  });
  await page.route('**/api/home/sidebar', (route) =>
    route.fulfill({
      json: { mostViewed: [{ ...one, viewers: 3 }], upcoming: [two], stale: false },
    }),
  );
  const today = new Date('2026-10-13T16:00:00Z');
  await page.clock.install({ time: today });
  await page.route('**/api/calendar?**', (route) =>
    route.fulfill({
      json: {
        state: 'ready',
        items: [
          {
            id: 'air',
            route: 'air',
            title: 'Today episode',
            cover: '/icon.svg',
            airType: 'sub',
            episode: 2,
            airingAt: today.toISOString(),
            providerUrl: 'https://animeschedule.net/anime/test',
          },
        ],
      },
    }),
  );
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Weekly One', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add to watchlist', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Next featured title' }).click();
  await expect(page.getByRole('heading', { name: 'Weekly Two', exact: true })).toBeVisible();
  const hero = await page.locator('.weekly-hero').boundingBox(),
    feed = await page.locator('.release-section').boundingBox();
  expect(hero.height).toBeGreaterThan(page.viewportSize().height * 0.8);
  const rail = page.getByRole('complementary', { name: 'Anime highlights' });
  for (const name of ['Most viewed', 'Upcoming anime', 'Airing schedule', 'Community'])
    await expect(rail.getByRole('region', { name, exact: true })).toBeVisible();
  await expect(rail.getByText('3 viewers')).toBeVisible();
  const schedule = rail.getByRole('region', { name: 'Airing schedule' });
  await expect(schedule.getByRole('link', { name: /Today episode/ })).toBeVisible();
  await schedule.getByRole('button', { name: 'upcoming', exact: true }).click();
  await expect(schedule.getByRole('button', { name: 'upcoming', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await schedule.getByRole('button', { name: 'all', exact: true }).click();
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

test('sidebar schedule shows the selected day timezone across daylight saving changes', async ({
  page,
  context,
  baseURL,
}) => {
  await context.route('**/*', (route) =>
    new URL(route.request().url()).origin === baseURL ? route.continue() : route.abort(),
  );
  await page.clock.install({ time: new Date('2026-10-27T16:00:00Z') });
  await page.route('**/api/home?**', (route) =>
    route.fulfill({ json: { hot: [], releases: [], state: 'ready' } }),
  );
  await page.route('**/api/home/sidebar', (route) =>
    route.fulfill({ json: { upcoming: [], mostViewed: [], stale: false } }),
  );
  await page.route('**/api/calendar?**', (route) =>
    route.fulfill({
      json: {
        state: 'ready',
        items: [
          {
            id: 'dst',
            title: 'Sunday episode',
            airType: 'sub',
            airingAt: '2026-11-01T17:00:00Z',
            episode: 1,
            cover: '/icon.svg',
            providerUrl: 'https://animeschedule.net/anime/test',
          },
        ],
      },
    }),
  );
  await page.goto('/');
  const schedule = page.getByRole('region', { name: 'Airing schedule', exact: true });
  await expect(schedule.getByText('GMT-4', { exact: true })).toBeVisible();
  await schedule.getByRole('button', { name: 'Sun', exact: true }).click();
  await expect(schedule.getByText('GMT-5', { exact: true })).toBeVisible();
  await expect(schedule.getByRole('link', { name: /Sunday episode/ })).toContainText('12:00 PM');
});
