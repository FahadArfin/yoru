import { test, expect } from '@playwright/test';

for (const category of ['manga', 'manhwa']) {
  test(`${category} full catalog shows 144 titles with working pagination and filters`, async ({
    page,
    context,
    baseURL,
  }) => {
    await context.route('**/*', (route) =>
      new URL(route.request().url()).origin === baseURL ? route.continue() : route.abort(),
    );
    const queries = [];
    await page.route('**/api/catalog?**', (route) => {
      const params = new URL(route.request().url()).searchParams;
      queries.push(Object.fromEntries(params));
      const current = Number(params.get('page'));
      return route.fulfill({
        json: {
          items: Array.from({ length: current === 1 ? 144 : 6 }, (_, i) => ({
            id: `mal-manga-${(current - 1) * 144 + i + 1}`,
            title: `Long page title ${(current - 1) * 144 + i + 1}`,
            category: category.toUpperCase(),
            cover: '/icon.svg',
            genres: ['Action'],
          })),
          total: 150,
          pages: 2,
          page: current,
        },
      });
    });
    await page.goto(`/browse/${category}?view=all`);
    await expect(page.locator('.browse-grid .poster-card')).toHaveCount(144);
    expect(queries.at(-1).limit).toBe('144');
    await expect(page.locator('.results-bar')).toContainText('144 titles on this page');
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(
      false,
    );
    await page.getByRole('button', { name: 'Next', exact: true }).click();
    await expect(page).toHaveURL(/page=2/);
    await expect(page.locator('.browse-grid .poster-card')).toHaveCount(6);
    await expect(
      page.getByRole('link', { name: 'View Long page title 145', exact: true }),
    ).toBeVisible();
    await expect.poll(() => page.evaluate(() => scrollY)).toBe(0);
    await expect(page.getByRole('button', { name: 'Next', exact: true })).toBeDisabled();
    await page.getByLabel('Genre', { exact: true }).selectOption('Action');
    await expect(page.locator('.browse-grid .poster-card')).toHaveCount(144);
    expect(queries.at(-1)).toMatchObject({ page: '1', limit: '144', genre: 'Action' });
    await page.reload();
    await expect(page.locator('.browse-grid .poster-card')).toHaveCount(144);
    await expect(page.getByLabel('Genre', { exact: true })).toHaveValue('Action');
  });
}

test('compact catalog keeps 48-title pagination, filters and navigation usable', async ({
  page,
  context,
  baseURL,
  isMobile,
}) => {
  await context.route('**/*', (route) =>
    new URL(route.request().url()).origin === baseURL ? route.continue() : route.abort(),
  );
  if (!isMobile) await page.setViewportSize({ width: 1920, height: 1080 });
  const queries = [];
  await page.route('**/api/catalog?**', (route) => {
    const params = new URL(route.request().url()).searchParams;
    queries.push(Object.fromEntries(params));
    const current = Number(params.get('page'));
    const category = params.get('category');
    return route.fulfill({
      json: {
        items: Array.from({ length: 48 }, (_, i) => ({
          id: `mal-${category === 'ANIME' ? 'anime' : 'manga'}-${(current - 1) * 48 + i + 1}`,
          title: `Catalog title ${(current - 1) * 48 + i + 1}`,
          category,
          cover: '/icon.svg',
          format: category === 'ANIME' ? 'TV' : 'MANGA',
          genres: ['Action'],
        })),
        total: 96,
        pages: 2,
        page: current,
      },
    });
  });
  await page.goto('/browse/anime?view=all');
  await expect(page.locator('.browse-grid .poster-card')).toHaveCount(48);
  expect(queries.at(-1).limit).toBe('48');
  await expect(page.locator('.sidebar')).toBeHidden();
  await expect(page.locator('.topbar').getByRole('link', { name: 'Yoru home' })).toBeVisible();
  const geometry = await page.locator('.browse-grid').evaluate((el) => ({
    columns: getComputedStyle(el).gridTemplateColumns.split(' ').length,
    top: el.getBoundingClientRect().top,
    overflow: document.documentElement.scrollWidth > innerWidth,
  }));
  expect(geometry.columns).toBe(isMobile ? 2 : 9);
  // The category strip adds one compact row above the existing filters.
  expect(geometry.top).toBeLessThan(isMobile ? 470 : 280);
  expect(geometry.overflow).toBe(false);
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(
    page.getByRole('link', { name: 'View Catalog title 49', exact: true }),
  ).toBeVisible();
  await expect.poll(() => page.evaluate(() => scrollY)).toBe(0);
  expect(queries.at(-1).page).toBe('2');
  await expect(page.getByRole('button', { name: 'Next', exact: true })).toBeDisabled();
  await page.getByLabel('Search catalog').fill('space');
  await page.locator('.inline-search').getByRole('button', { name: 'Search', exact: true }).click();
  await expect(page).toHaveURL(/q=space/);
  await page.getByLabel('Genre', { exact: true }).selectOption('Action');
  await page.getByLabel('Sort titles').selectOption('score');
  await expect
    .poll(() => queries.at(-1))
    .toMatchObject({ search: 'space', genre: 'Action', sort: 'score', page: '1', limit: '48' });
  await page.getByRole('button', { name: 'Reset filters' }).click();
  await expect(page.getByLabel('Search catalog')).toHaveValue('');
  await expect(page.getByLabel('Genre', { exact: true })).toHaveValue('');
  await expect(page.getByLabel('Sort titles')).toHaveValue('trending');
  await page.getByLabel('Catalog type').selectOption('manga');
  await expect(page).toHaveURL(/\/browse\/manga$/);
  await expect(page.getByRole('region', { name: 'Featured manga', exact: true })).toBeVisible();
  await page
    .getByRole('region', { name: 'Action collection', exact: true })
    .scrollIntoViewIfNeeded();
  await expect(
    page
      .getByRole('region', { name: 'Action collection', exact: true })
      .getByRole('link', { name: 'View Catalog title 1', exact: true }),
  ).toHaveAttribute('href', '/title/mal-manga-1');
  await expect(page.getByRole('button', { name: 'Open navigation' })).toHaveCount(0);
  await expect(page.locator('.sidebar')).toBeHidden();
});
