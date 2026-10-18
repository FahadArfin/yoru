import { test, expect } from '@playwright/test';
import { releasedEpisodes } from '../../server/home-core.js';

test('one series card switches to the selected language and its own episode', async ({
  page,
  context,
  baseURL,
}) => {
  await context.route('**/*', (route) =>
    new URL(route.request().url()).origin === baseURL ? route.continue() : route.abort(),
  );
  const now = Date.now();
  const entries = [
    {
      id: 'show-dub',
      route: 'show',
      title: 'Shared series',
      airType: 'dub',
      episode: 2,
      airingAt: new Date(now - 1000).toISOString(),
    },
    {
      id: 'show-sub',
      route: 'show',
      title: 'Shared series',
      airType: 'sub',
      episode: 4,
      airingAt: new Date(now - 2000).toISOString(),
    },
  ].map((entry) => ({ ...entry, media: { id: 'mal-anime-21' }, cover: '/icon.svg' }));
  await page.route('**/api/home?**', (route) => {
    const language = new URL(route.request().url()).searchParams.get('language');
    return route.fulfill({
      json: {
        hot: [],
        state: 'ready',
        language,
        releases: releasedEpisodes(entries, language, now),
      },
    });
  });
  await page.goto('/');
  const section = page.getByRole('region', { name: 'Just released' });
  for (const [filter, language, episode] of [
    ['All releases', 'dub', 2],
    ['English sub', 'sub', 4],
    ['English dub', 'dub', 2],
    ['All releases', 'dub', 2],
  ]) {
    await section.getByRole('button', { name: filter, exact: true }).click();
    await expect(section.locator('.release-card')).toHaveCount(1);
    await expect(section.locator('.release-card')).toHaveAttribute(
      'href',
      `/watch/mal-anime-21/${episode}?language=${language}`,
    );
  }
  await page
    .getByRole('region', { name: 'Most popular', exact: true })
    .getByRole('button', { name: 'Most popular', exact: true })
    .click();
  await expect(section.locator('.discovery-preview-card')).toHaveCount(1);
});

test('an incomplete Chinese feed does not claim there were no releases', async ({
  page,
  context,
  baseURL,
}) => {
  await context.route('**/*', (route) =>
    new URL(route.request().url()).origin === baseURL ? route.continue() : route.abort(),
  );
  await page.route('**/api/home?**', (route) =>
    route.fulfill({ json: { hot: [], releases: [], state: 'stale', stale: true } }),
  );
  await page.goto('/');
  await page.getByRole('button', { name: 'Chinese releases', exact: true }).click();
  const section = page.getByRole('region', { name: 'Just released' });
  await expect(
    section.getByRole('heading', { name: 'The release feed is taking a break.' }),
  ).toBeVisible();
  await expect(section.getByText('No new Chinese episodes in the last seven days.')).toHaveCount(0);
  await expect(section.getByRole('button', { name: 'Refresh releases' })).toBeVisible();
});

test('release filters keep correct card languages and Chinese original links on desktop and phone', async ({
  page,
  context,
  baseURL,
}) => {
  await context.route('**/*', (route) =>
    new URL(route.request().url()).origin === baseURL ? route.continue() : route.abort(),
  );
  const entries = [
    { id: 'sub', title: 'Sub episode', airType: 'sub', donghua: false },
    { id: 'dub', title: 'Dub episode', airType: 'dub', donghua: false },
    { id: 'chinese', title: 'Chinese episode', airType: 'raw', donghua: true },
  ].map((x) => ({
    ...x,
    route: x.id,
    episode: 3,
    media: { id: 'mal-anime-21' },
    cover: '/icon.svg',
    airingAt: new Date().toISOString(),
    providerUrl: `https://animeschedule.net/anime/${x.id}`,
  }));
  await page.route('**/api/home?**', (route) => {
    const filter = new URL(route.request().url()).searchParams.get('language');
    return route.fulfill({
      json: {
        hot: [],
        state: 'ready',
        language: filter,
        releases: entries.filter(
          (x) => filter === 'all' || (filter === 'chinese' ? x.donghua : x.airType === filter),
        ),
      },
    });
  });
  await page.goto('/');
  const section = page.getByRole('region', { name: 'Just released' });
  const filters = section.getByRole('group', { name: 'Release filter' });
  await expect(filters.getByRole('button', { name: 'All releases', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(section.locator('.release-card')).toHaveCount(3);
  await expect(section.getByRole('link', { name: /Sub episode/ })).toHaveAttribute(
    'href',
    '/watch/mal-anime-21/3?language=sub',
  );
  await expect(section.getByRole('link', { name: /Dub episode/ })).toHaveAttribute(
    'href',
    '/watch/mal-anime-21/3?language=dub',
  );
  await expect(section.getByRole('link', { name: /Chinese episode/ })).toHaveAttribute(
    'href',
    'https://animeschedule.net/anime/chinese',
  );
  await expect(section.getByRole('link', { name: /Dub episode/ })).toContainText('ENG DUB');
  for (const [name, title] of [
    ['English sub', 'Sub episode'],
    ['English dub', 'Dub episode'],
    ['Chinese releases', 'Chinese episode'],
  ]) {
    await filters.getByRole('button', { name, exact: true }).click();
    await expect(filters.getByRole('button', { name, exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(section.locator('.release-card')).toHaveCount(1);
    await expect(section.getByRole('link', { name: new RegExp(title) })).toBeVisible();
  }
  await filters.getByRole('button', { name: 'All releases', exact: true }).click();
  await expect(section.locator('.release-card')).toHaveCount(3);
  for (const name of ['All releases', 'English sub', 'English dub', 'Chinese releases'])
    await expect(filters.getByRole('button', { name, exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
});
