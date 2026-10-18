import { test, expect } from '@playwright/test';

test('catalog controls filter each category without a duplicate navigation strip', async ({
  page,
  context,
  baseURL,
}) => {
  await context.route('**/*', (route) =>
    new URL(route.request().url()).origin === baseURL ? route.continue() : route.abort(),
  );
  const queries = [];
  await page.route('**/api/catalog?**', (route) => {
    queries.push(Object.fromEntries(new URL(route.request().url()).searchParams));
    return route.fulfill({ json: { items: [], total: 0, pages: 1, page: 1 } });
  });
  await page.goto('/browse/anime?view=all');
  await expect(page.getByRole('navigation', { name: 'anime collections' })).toHaveCount(0);
  const filters = page.getByRole('region', { name: 'Catalog filters' });
  await expect(filters).toHaveCount(1);
  await filters.getByLabel('Anime format').selectOption('movie');
  await expect(page).toHaveURL(/format=movie/);
  await expect.poll(() => queries.at(-1)).toMatchObject({ category: 'ANIME', format: 'movie' });
  await filters.getByLabel('Genre', { exact: true }).selectOption('Romance');
  await filters.getByLabel('Sort titles').selectOption('title');
  await expect
    .poll(() => queries.at(-1))
    .toMatchObject({
      format: 'movie',
      genre: 'Romance',
      sort: 'title',
    });
  for (const category of ['manga', 'manhwa']) {
    await page
      .getByRole('navigation', { name: 'Explore Yoru' })
      .getByRole('link', { name: new RegExp(`^${category}$`, 'i') })
      .click();
    await expect(page.getByRole('navigation', { name: `${category} collections` })).toHaveCount(0);
    await expect(filters).toHaveCount(1);
    await expect(filters.getByLabel('Anime format')).toHaveCount(0);
    await filters.getByLabel('Genre', { exact: true }).selectOption('Fantasy');
    await expect
      .poll(() => queries.at(-1))
      .toMatchObject({ category: category.toUpperCase(), genre: 'Fantasy' });
    expect(queries.at(-1).format).toBeUndefined();
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  await page
    .getByRole('navigation', { name: 'Explore Yoru' })
    .getByRole('link', { name: 'My Space', exact: true })
    .click();
  await expect(page.locator('.category-navigation')).toHaveCount(0);
});
