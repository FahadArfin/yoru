import { test, expect } from '@playwright/test';

for (const [category, id] of [
  ['MANGA', 'mal-manga-21'],
  ['MANHWA', 'mal-manga-121496'],
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
    expect(requests[0].get('genre')).toBe(media.genres[0]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await recommendations.getByRole('link', { name: 'See more', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/browse/${category.toLowerCase()}\\?`));
    expect(new URL(page.url()).searchParams.get('genre')).toBe(media.genres[0]);
  });
}

test('recommendations fall back from missing genre matches and recover after a catalog failure', async ({
  page,
  context,
  baseURL,
}) => {
  await context.route('**/*', (route) =>
    new URL(route.request().url()).origin === baseURL ? route.continue() : route.abort(),
  );
  let available = false;
  await page.route('**/api/catalog?*', (route) => {
    const genre = new URL(route.request().url()).searchParams.get('genre');
    if (genre) return route.fulfill({ json: { items: [] } });
    return available
      ? route.fulfill({
          json: {
            items: [
              {
                id: 'mal-manga-900010',
                title: 'Another read',
                category: 'MANGA',
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
  await expect(recommendations.getByRole('link', { name: 'See more' })).toHaveAttribute(
    'href',
    '/browse/manga?sort=popular',
  );
});
