import { navigatePrimary } from './navigation';
import { test, expect } from '@playwright/test';
import { fileURLToPath } from 'node:url';
const fixture = (name) => fileURLToPath(new URL(`../fixtures/${name}.png`, import.meta.url));
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
    banner: '/banner-4k.png',
    category: 'ANIME',
    genres: ['Adventure'],
    format: 'TV',
  });
  const one = media('mal-anime-21', 'Weekly One'),
    two = media('mal-anime-52991', 'Weekly Two');
  await page.route('**/banner-4k.png', (route) => route.fulfill({ path: fixture('banner-4k') }));
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
            airType: language === 'dub' ? 'dub' : 'sub',
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
  await page.locator('.weekly-hero').hover();
  await page.getByRole('button', { name: 'Next featured title' }).click();
  await expect(page.getByRole('heading', { name: 'Weekly Two', exact: true })).toBeVisible();
  const hero = await page.locator('.weekly-hero').boundingBox(),
    feed = await page.locator('.release-section').boundingBox();
  expect(hero.height).toBeLessThan(page.viewportSize().height * 0.75);
  const rail = page.getByRole('complementary', { name: 'Anime highlights' });
  for (const name of ['Most viewed', 'Upcoming anime'])
    await expect(rail.getByRole('region', { name, exact: true })).toHaveCount(0);
  await expect(rail).toHaveCount(0);
  const schedule = page.getByRole('region', { name: 'Airing schedule' });
  await expect(rail.getByRole('region', { name: 'Airing schedule' })).toHaveCount(0);
  const scheduleBox = await schedule.boundingBox();
  const collectionBox = await page.getByRole('heading', { name: 'More stories' }).boundingBox();
  const columnBox = await page.locator('.home-release-column').boundingBox();
  expect(scheduleBox.y + scheduleBox.height).toBeLessThan(collectionBox.y);
  expect(Math.abs(scheduleBox.width - columnBox.width)).toBeLessThan(2);
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
  await navigatePrimary(page, 'Schedule');
  await expect(page).toHaveURL(/\/schedule$/);
});

test('banner rejects blurry, missing and portrait artwork, and rechecks resolution on resize', async ({
  page,
  context,
  baseURL,
}) => {
  await context.route('**/*', (route) =>
    new URL(route.request().url()).origin === baseURL ? route.continue() : route.abort(),
  );
  await page.route('**/api/home?**', (route) =>
    route.fulfill({
      json: {
        state: 'ready',
        releases: [],
        hot: [
          { id: 'mal-anime-1', title: 'Low resolution', banner: '/banner-720p.png' },
          { id: 'mal-anime-2', title: 'Missing artwork', banner: '/missing-banner.png' },
          { id: 'mal-anime-3', title: 'Poster only', cover: '/icon.svg' },
          { id: 'mal-anime-4', title: 'Sharp artwork', banner: '/banner-hd.png' },
        ],
      },
    }),
  );
  for (const name of ['banner-720p', 'banner-hd'])
    await page.route(`**/${name}.png`, (route) => route.fulfill({ path: fixture(name) }));
  await page.route('**/missing-banner.png', (route) => route.abort());
  await page.setViewportSize({ width: 800, height: 600 });
  await page.goto('/');
  const hero = page.getByRole('region', { name: 'Hot this week' });
  // Mobile density needs more pixels for the tall crop, even at narrow widths.
  const density = await page.evaluate(() => Math.min(devicePixelRatio, 2));
  if (density === 1) {
    await expect(hero.getByRole('heading', { name: 'Sharp artwork' })).toBeVisible();
    await expect(hero.locator('.weekly-backdrop')).toHaveAttribute('src', '/banner-hd.png');
  }
  await page.setViewportSize({ width: 2400, height: 1200 });
  await expect(hero.getByRole('link', { name: 'Explore anime' })).toBeVisible();
  await expect(hero.locator('.weekly-backdrop')).toHaveCount(0);
  await expect(
    hero.getByRole('button', { name: /Feature (Low resolution|Missing artwork|Poster only)/ }),
  ).toHaveCount(0);
});

test('a sharp banner can recover after a slow connection timeout', async ({
  page,
  context,
  baseURL,
}) => {
  await context.route('**/*', (route) =>
    new URL(route.request().url()).origin === baseURL ? route.continue() : route.abort(),
  );
  await page.clock.install();
  let releaseImage;
  let imageRequested;
  const requested = new Promise((resolve) => {
    imageRequested = resolve;
  });
  const pendingImage = new Promise((resolve) => {
    releaseImage = resolve;
  });
  await page.route('**/slow-banner.png', async (route) => {
    imageRequested();
    await pendingImage;
    await route.fulfill({ path: fixture('banner-4k') });
  });
  await page.route('**/api/home?**', (route) =>
    route.fulfill({
      json: {
        state: 'ready',
        releases: [],
        hot: [{ id: 'mal-anime-21', title: 'Late sharp banner', banner: '/slow-banner.png' }],
      },
    }),
  );
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  const hero = page.getByRole('region', { name: 'Hot this week' });
  await expect(hero.getByLabel('Loading weekly picks')).toBeVisible();
  await requested;
  await page.clock.runFor(11000);
  await expect(hero.getByRole('link', { name: 'Explore anime' })).toBeVisible();
  releaseImage();
  await expect(hero.getByRole('heading', { name: 'Late sharp banner' })).toBeVisible();
  await expect(hero.locator('.weekly-backdrop')).toHaveAttribute('src', '/slow-banner.png');
});

test('late artwork cannot evict the current slide from the larger weekly pool', async ({
  page,
  context,
  baseURL,
}) => {
  await context.route('**/*', (route) =>
    new URL(route.request().url()).origin === baseURL ? route.continue() : route.abort(),
  );
  let releaseGroup;
  const pending = new Promise((resolve) => {
    releaseGroup = resolve;
  });
  await page.route('**/late-group.png', async (route) => {
    await pending;
    await route.fulfill({ path: fixture('banner-4k') });
  });
  await page.route('**/first-loaded.png', (route) => route.fulfill({ path: fixture('banner-4k') }));
  await page.route('**/api/home?**', (route) =>
    route.fulfill({
      json: {
        state: 'ready',
        releases: [],
        hot: Array.from({ length: 9 }, (_, i) => ({
          id: `mal-anime-${100 + i}`,
          title: `Weekly pick ${i + 1}`,
          banner: i === 8 ? '/first-loaded.png' : '/late-group.png',
        })),
      },
    }),
  );
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  const hero = page.getByRole('region', { name: 'Hot this week' });
  await expect(hero.getByRole('heading', { name: 'Weekly pick 9', exact: true })).toBeVisible();
  releaseGroup();
  await expect(hero.locator('.weekly-dot')).toHaveCount(8);
  await expect(hero.getByRole('heading', { name: 'Weekly pick 9', exact: true })).toBeVisible();
  await page.locator('.weekly-hero').hover();
  await hero.getByRole('button', { name: 'Next featured title' }).click();
  await expect(hero.getByRole('heading', { name: 'Weekly pick 1', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
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
  await schedule.getByRole('button', { name: /^Sun/ }).click();
  await expect(schedule.getByText('GMT-5', { exact: true })).toBeVisible();
  await expect(schedule.getByRole('link', { name: /Sunday episode/ })).toContainText('12:00 PM');
});
