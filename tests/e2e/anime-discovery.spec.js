import { test, expect } from '@playwright/test';

test('anime discovery precedes genres and preserves title, episode and filtered navigation', async ({
  page,
  context,
  baseURL,
}) => {
  await context.route('**/*', (route) =>
    new URL(route.request().url()).origin === baseURL ? route.continue() : route.abort(),
  );
  const media = {
    id: 'mal-anime-1',
    title: 'New anime series',
    category: 'ANIME',
    cover: '/icon.svg',
    episodes: 12,
    startDate: '2026-10-01',
    viewers: 3,
  };
  await page.route('**/api/home?**', (route) =>
    route.fulfill({ json: { hot: [], releases: [], state: 'ready' } }),
  );
  await page.route('**/api/catalog?**', (route) =>
    route.fulfill({ json: { items: [media], pages: 1, total: 1 } }),
  );
  await page.route('**/api/home/discovery?**', (route) => {
    const params = new URL(route.request().url()).searchParams;
    return route.fulfill({
      json: {
        state: 'ready',
        mode: params.get('mode'),
        period: params.get('period'),
        items: [{ ...media, title: `${params.get('mode')} ${params.get('period')}` }],
      },
    });
  });
  await page.goto('/browse/anime');
  const discovery = page.getByRole('region', { name: 'Discover anime', exact: true });
  await expect(discovery.getByRole('tab', { name: 'New series', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(discovery.getByRole('link', { name: /New anime series/ })).toHaveAttribute(
    'href',
    '/title/mal-anime-1',
  );
  const genres = page.getByRole('heading', { name: 'Explore by genre', exact: true });
  await expect(page.getByRole('navigation', { name: 'anime collections' })).toHaveCount(0);
  const filters = page.getByRole('region', { name: 'Catalog filters' });
  await expect(filters).toHaveCount(1);
  const fullCollection = page.getByRole('region', { name: 'Full collection', exact: true });
  await expect(fullCollection.getByRole('region', { name: 'Catalog filters' })).toHaveCount(1);
  expect((await filters.boundingBox()).y).toBeGreaterThan((await genres.boundingBox()).y);
  await expect(filters.getByLabel('Anime format')).toHaveValue('');

  expect((await discovery.boundingBox()).y).toBeLessThan((await genres.boundingBox()).y);
  await discovery.getByRole('tab', { name: 'Most popular', exact: true }).click();
  await discovery.getByRole('button', { name: 'Last month', exact: true }).click();
  await expect(discovery.getByRole('link', { name: /popular month/ })).toBeVisible();
  await discovery.getByRole('tab', { name: /Trending/ }).click();
  await expect(discovery.getByRole('link', { name: /trending week/ })).toHaveAttribute(
    'href',
    '/watch/mal-anime-1/latest',
  );
  await expect(discovery).toContainText('3 viewers this week');
  await page
    .getByRole('region', { name: 'Action collection', exact: true })
    .getByRole('link', { name: 'Show more action' })
    .click();
  await expect(page).toHaveURL(/genre=Action/);
  await expect(discovery).toHaveCount(0);
  await expect(page.getByLabel('Genre', { exact: true })).toHaveValue('Action');
  await page.goto('/browse/anime?format=movie');
  await expect(discovery).toHaveCount(0);
  await expect(page.getByLabel('Anime format')).toHaveValue('movie');
  await page.goto('/browse/anime');
  await page
    .getByRole('navigation', { name: 'Explore genres', exact: true })
    .getByRole('link', { name: 'Full collection', exact: true })
    .click();
  await expect(fullCollection.getByLabel('Search catalog')).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  await fullCollection.getByLabel('Search catalog').fill('New anime');
  await fullCollection.getByRole('button', { name: 'Search', exact: true }).click();
  await expect(page).toHaveURL(/q=New\+anime/);
  await expect(page.getByRole('heading', { name: 'Results for “New anime”' })).toBeVisible();
  await expect(filters).toHaveCount(1);
});
