import { test, expect } from '@playwright/test';

test('genre data and covers start loading before the shelf reaches the viewport', async ({
  page,
  context,
  baseURL,
}) => {
  await context.route('**/*', (route) =>
    new URL(route.request().url()).origin === baseURL ? route.continue() : route.abort(),
  );
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.route('**/api/catalog?**', (route) => {
    const genre = new URL(route.request().url()).searchParams.get('genre');
    return route.fulfill({
      json: {
        items: genre
          ? [
              {
                id: 'mal-manga-21',
                category: 'MANGA',
                title: `${genre} story`,
                cover: '/cover-placeholder.svg',
              },
            ]
          : [],
        pages: 1,
      },
    });
  });
  await page.goto('/browse/manga');
  const shelf = page.getByRole('region', { name: 'Sci-Fi collection', exact: true });
  await shelf.evaluate((element) =>
    window.scrollTo({
      top: element.getBoundingClientRect().top + window.scrollY - window.innerHeight - 1000,
      behavior: 'instant',
    }),
  );
  // Still 1,000px below the screen, with both data and artwork already loading.
  await expect(shelf.locator('.poster-card')).toHaveCount(1);
  await expect(shelf.locator('.cover-image')).toHaveAttribute('loading', 'eager');
  expect(await shelf.evaluate((element) => element.getBoundingClientRect().top > innerHeight)).toBe(
    true,
  );
});

for (const category of ['anime', 'manga', 'manhwa']) {
  test(`${category} genre shelves stay in two rows and open the complete filtered collection`, async ({
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
      const limit = Number(params.get('limit') || 24);
      const current = Number(params.get('page') || 1);
      const genre = params.get('genre') || 'Full';
      return route.fulfill({
        json: {
          items: Array.from({ length: limit }, (_, i) => ({
            id: `mal-${category === 'anime' ? 'anime' : 'manga'}-${(current - 1) * limit + i + 1}`,
            title: `${genre} ${category} ${(current - 1) * limit + i + 1}`,
            category: category.toUpperCase(),
            cover: '/icon.svg',
            genres: [genre],
          })),
          page: current,
          pages: 2,
          total: limit * 2,
        },
      });
    });
    await page.goto(`/browse/${category}`);
    const action = page.getByRole('region', { name: 'Action collection', exact: true });
    await action.scrollIntoViewIfNeeded();
    await expect(action.locator('.poster-card')).toHaveCount(12);
    expect(queries.filter((q) => q.genre).length).toBeLessThan(13);
    const geometry = await action.locator('.genre-shelf-track').evaluate((el) => ({
      rows: new Set([...el.children].map((card) => Math.round(card.getBoundingClientRect().top)))
        .size,
      overflow: document.documentElement.scrollWidth > innerWidth,
    }));
    expect(geometry).toEqual({ rows: 2, overflow: false });
    await expect(action.getByRole('button', { name: 'Previous action titles' })).toBeDisabled();
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await action.getByRole('button', { name: 'Next action titles' }).click();
    if (isMobile) {
      await expect
        .poll(() => action.locator('.genre-shelf-track').evaluate((el) => el.scrollLeft))
        .toBeGreaterThan(0);
      await action.getByRole('button', { name: 'Next action titles' }).click();
      await expect
        .poll(() =>
          action
            .locator('.genre-shelf-track')
            .evaluate((el) => el.scrollLeft + el.clientWidth >= el.scrollWidth - 4),
        )
        .toBe(true);
      await action.getByRole('button', { name: 'Next action titles' }).click();
    }
    await expect(action.getByText('Selection 2 · 12 titles')).toBeVisible();
    await expect(action.getByRole('button', { name: 'Previous action titles' })).toBeEnabled();
    await action.getByRole('button', { name: 'Previous action titles' }).click();
    await expect(action.getByText('Selection 1 · 12 titles')).toBeVisible();
    await action.getByRole('link', { name: 'Show more action' }).click();
    await expect(page).toHaveURL(new RegExp(`/browse/${category}\\?genre=Action$`));
    await expect(page.getByLabel('Genre', { exact: true })).toHaveValue('Action');
    await expect(page.locator('.browse-grid .poster-card')).toHaveCount(48);
    await page.goBack();
    const full = page.getByRole('region', { name: 'Full collection', exact: true });
    await full.scrollIntoViewIfNeeded();
    await expect(full.locator('.poster-card')).toHaveCount(12);
    const order = await page
      .locator('.genre-collection')
      .evaluateAll((els) => els.map((el) => el.getAttribute('aria-label')));
    expect(order.at(-1)).toBe('Full collection');
    await full.getByRole('link', { name: 'Show more full collection' }).click();
    await expect(page).toHaveURL(new RegExp(`/browse/${category}\\?view=all$`));
    await expect(page.locator('.browse-grid .poster-card')).toHaveCount(48);
    expect(queries.filter((q) => q.genre).every((q) => q.category === category.toUpperCase())).toBe(
      true,
    );
  });
}

test('genre shelf failure can retry without hiding other collections', async ({ page }) => {
  let attempts = 0;
  await page.route('**/api/catalog?**', (route) => {
    const params = new URL(route.request().url()).searchParams;
    if (params.get('genre') !== 'Action') return route.fulfill({ json: { items: [], pages: 1 } });
    attempts++;
    return route.fulfill({
      json: {
        items:
          attempts === 1 || params.get('page') === '2'
            ? []
            : [
                {
                  id: 'mal-anime-1',
                  title: 'Recovered action',
                  category: 'ANIME',
                  cover: '/icon.svg',
                },
              ],
        pages: 2,
        providerUnavailable: attempts === 1,
      },
    });
  });
  await page.goto('/browse/anime');
  const shelf = page.getByRole('region', { name: 'Action collection', exact: true });
  await shelf.scrollIntoViewIfNeeded();
  await expect(shelf.getByText('This collection is temporarily unavailable.')).toBeVisible();
  await shelf.getByRole('button', { name: 'Try again', exact: true }).click();
  await expect(shelf.getByRole('link', { name: 'View Recovered action' })).toBeVisible();
  await shelf.getByRole('button', { name: 'Next action titles' }).click();
  await expect(shelf.getByText('No action anime titles found yet.')).toBeVisible();
  await expect(shelf.getByRole('button', { name: 'Next action titles' })).toBeDisabled();
  await shelf.getByRole('button', { name: 'Previous action titles' }).click();
  await expect(shelf.getByRole('link', { name: 'View Recovered action' })).toBeVisible();
});
