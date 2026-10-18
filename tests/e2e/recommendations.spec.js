import { test, expect } from '@playwright/test';
import { recommendationGenre } from '../../src/recommendations.js';

for (const [category, id] of [
  ['MANGA', 'mal-manga-21'],
  ['MANHWA', 'mal-manga-121496'],
  ['ANIME', 'mal-anime-52991'],
]) {
  test(`${category} recommendations show related covers and open more titles in the same category`, async ({
    page,
    context,
    baseURL,
  }) => {
    await context.route('**/*', (route) =>
      new URL(route.request().url()).origin === baseURL ? route.continue() : route.abort(),
    );
    const response = await context.request.get(`/api/media/${id}`);
    const data = await response.json();
    const media = data.media || data;
    const requests = [];
    await page.route('**/api/catalog?*', (route) => {
      requests.push(new URL(route.request().url()).searchParams);
      return route.fulfill({
        json: {
          items: [
            media,
            ...Array.from({ length: 6 }, (_, i) => ({
              id: `mal-manga-${900001 + i}`,
              title: `Related story ${i + 1}`,
              category,
              genres: media.genres,
              cover: '/icon.svg?test-cover',
            })),
          ],
          total: 7,
        },
      });
    });
    await page.goto(`/title/${id}`);
    const recommendations = page.getByRole('region', { name: 'Recommendations', exact: true });
    await expect(recommendations.locator('.manga-recommendation-card')).toHaveCount(4);
    await expect(
      recommendations.getByRole('link', { name: 'Related story 1', exact: true }),
    ).toHaveAttribute('href', '/title/mal-manga-900001');
    await expect(recommendations.locator('img')).toHaveCount(4);
    await expect(
      page.getByRole('heading', { name: 'Alternative titles', exact: true }),
    ).toHaveCount(0);
    expect(requests[0].get('category')).toBe(category);
    expect(requests[0].get('genre')).toBe(recommendationGenre(media));
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await recommendations.getByRole('link', { name: 'See more', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/browse/${category.toLowerCase()}\\?`));
    expect(new URL(page.url()).searchParams.get('genre')).toBe(recommendationGenre(media));
  });
}

test('recommendations reject unrelated popular titles and recover after a catalog failure', async ({
  page,
  context,
  baseURL,
}) => {
  await context.route('**/*', (route) =>
    new URL(route.request().url()).origin === baseURL ? route.continue() : route.abort(),
  );
  let available = false;
  await page.route('**/api/media/mal-manga-21', (route) =>
    route.fulfill({
      json: {
        media: {
          id: 'mal-manga-21',
          title: 'A romance story',
          category: 'MANGA',
          genres: ['Drama', 'Romance'],
          cover: '/icon.svg?test-cover',
        },
      },
    }),
  );
  await page.route('**/api/catalog?*', (route) => {
    const genre = new URL(route.request().url()).searchParams.get('genre');
    if (genre !== 'Romance') return route.fulfill({ json: { items: [] } });
    return available
      ? route.fulfill({
          json: {
            items: [
              {
                id: 'mal-manga-900010',
                title: 'Another read',
                category: 'MANGA',
                genres: ['Romance', 'Drama'],
                cover: '/icon.svg?test-cover',
              },
              {
                id: 'mal-manga-2',
                title: 'Berserk',
                category: 'MANGA',
                genres: ['Action', 'Drama', 'Horror'],
                cover: '/icon.svg?test-cover',
              },
            ],
          },
        })
      : route.fulfill({ status: 503, json: { error: 'Catalog unavailable' } });
  });
  await page.goto('/title/mal-manga-21');
  const recommendations = page.getByRole('region', { name: 'Recommendations', exact: true });
  await expect(
    recommendations.getByText('Recommendations are unavailable right now.'),
  ).toBeVisible();
  available = true;
  await recommendations.getByRole('button', { name: 'Try again' }).click();
  await expect(
    recommendations.getByRole('link', { name: 'Another read', exact: true }),
  ).toBeVisible();
  await expect(recommendations.getByText('Berserk')).toHaveCount(0);
  await expect(recommendations.getByRole('link', { name: 'See more' })).toHaveAttribute(
    'href',
    '/browse/manga?sort=popular&genre=Romance',
  );
});

test('empty genre matches never become generic popular recommendations', async ({
  page,
  context,
  baseURL,
}) => {
  await context.route('**/*', (route) =>
    new URL(route.request().url()).origin === baseURL ? route.continue() : route.abort(),
  );
  const requests = [];
  await page.route('**/api/catalog?*', (route) => {
    requests.push(new URL(route.request().url()).searchParams);
    return route.fulfill({ json: { items: [] } });
  });
  await page.goto('/title/mal-manga-21');
  const section = page.getByRole('region', { name: 'Recommendations', exact: true });
  await expect(section.getByText('No close matches yet.')).toBeVisible();
  expect(requests.every((query) => query.has('genre'))).toBe(true);
  await expect(section.locator('.manga-recommendation-card')).toHaveCount(0);
});
