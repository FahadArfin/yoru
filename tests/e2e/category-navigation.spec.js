import { test, expect } from '@playwright/test';

test('category strip filters collections, dismisses menus, and follows the chosen category', async ({
  page,
  context,
  baseURL,
  isMobile,
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
  let nav = page.getByRole('navigation', { name: 'anime collections' });
  await expect(nav).toBeVisible();
  await nav.getByRole('button', { name: 'Types', exact: true }).click();
  await nav.getByRole('link', { name: 'Movies', exact: true }).click();
  await expect(page).toHaveURL(/format=movie/);
  await expect.poll(() => queries.at(-1)).toMatchObject({ category: 'ANIME', format: 'movie' });
  await expect(nav.getByRole('button', { name: 'Types', exact: true })).toHaveAttribute(
    'aria-expanded',
    'false',
  );
  const genres = nav.getByRole('button', { name: 'Genres', exact: true });
  await genres.click();
  await nav.getByRole('link', { name: 'Romance', exact: true }).click();
  await expect
    .poll(() => queries.at(-1))
    .toMatchObject({ category: 'ANIME', format: 'movie', genre: 'Romance' });
  await genres.click();
  await nav.getByRole('link', { name: 'Comedy', exact: true }).focus();
  await page.keyboard.press('Escape');
  await expect(genres).toBeFocused();
  await expect(genres).toHaveAttribute('aria-expanded', 'false');
  await genres.click();
  await page.getByRole('combobox', { name: 'Search anime, manga, and manhwa' }).click();
  await expect(genres).toHaveAttribute('aria-expanded', 'false');
  await nav.getByRole('link', { name: 'A–Z', exact: true }).click();
  await expect
    .poll(() => queries.at(-1))
    .toMatchObject({ format: 'movie', genre: 'Romance', sort: 'title' });
  for (const category of ['manga', 'manhwa']) {
    await page
      .getByRole('navigation', { name: 'Explore Yoru' })
      .getByRole('link', { name: new RegExp(`^${category}$`, 'i') })
      .click();
    nav = page.getByRole('navigation', { name: `${category} collections` });
    await expect(nav).toBeVisible();
    await expect(nav.getByRole('button', { name: 'Types', exact: true })).toHaveCount(0);
    await nav.getByRole('button', { name: 'Genres', exact: true }).click();
    await nav.getByRole('link', { name: 'Fantasy', exact: true }).click();
    await expect
      .poll(() => queries.at(-1))
      .toMatchObject({ category: category.toUpperCase(), genre: 'Fantasy' });
    expect(queries.at(-1).format).toBeUndefined();
  }
  await nav.getByRole('button', { name: 'Genres', exact: true }).click();
  const bounds = await page.locator('#category-genres').boundingBox();
  expect(bounds.x).toBeGreaterThanOrEqual(0);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(page.viewportSize().width);
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  expect(
    await page
      .locator('.category-navigation-row')
      .evaluate((el) => el.getBoundingClientRect().height),
  ).toBeLessThan(44);
  if (!isMobile)
    await expect(nav.getByRole('link', { name: 'Full collection', exact: true })).toBeVisible();
  await page
    .getByRole('navigation', { name: 'Explore Yoru' })
    .getByRole('link', { name: 'Community', exact: true })
    .click();
  await expect(page.locator('.category-navigation')).toHaveCount(0);
});
