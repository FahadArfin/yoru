import { test, expect } from '@playwright/test';
import { navigateCollection } from './navigation';

for (const category of ['manga', 'manhwa']) {
  test(`Yoru ${category} keeps discovery and Settings controls without extension catalogs`, async ({
    page,
    context,
    baseURL,
  }) => {
    await context.route('**/*', (route) =>
      new URL(route.request().url()).origin === baseURL ? route.continue() : route.abort(),
    );
    await page.route('**/api/reader/catalogs*', (route) =>
      route.fulfill({ json: { sources: [], complete: true } }),
    );
    const title = {
      id: 'mal-manga-1',
      title: 'Completed reader favorite',
      category: category.toUpperCase(),
      status: 'Finished',
      cover: '/icon.svg',
      score: 8,
    };
    for (const endpoint of ['**/api/catalog?**', '**/api/home/discovery?**']) {
      await page.route(endpoint, (route) =>
        route.fulfill({ json: { items: [title], total: 1, pages: 1, state: 'ready' } }),
      );
    }
    const nativeRequests = [];
    page.on('request', (request) => {
      if (/\/api\/reader\/(browse|discovery)(\?|$)/.test(request.url()))
        nativeRequests.push(request.url());
    });
    await page.addInitScript(() => {
      localStorage.setItem(
        'yoru:reader-integration-modes:guest:v1',
        JSON.stringify({ yoru: 'extensions', 'ara-ara': 'extensions' }),
      );
    });
    await page.goto(`/browse/${category}`);
    const hero = page.getByRole('region', { name: `Featured ${category}`, exact: true });
    await expect(hero).toBeVisible();
    await expect(
      page
        .getByRole('region', { name: 'New series', exact: true })
        .getByRole('button', { name: 'New series', exact: true }),
    ).toBeVisible();
    await expect(page.locator('.reader-catalog')).toHaveCount(0);
    const lastShelf = page.getByRole('region', { name: 'Full collection', exact: true });
    const shelfBox = await lastShelf.boundingBox();
    for (const name of ['Reader favorites', 'Completed stories']) {
      const panel = page.getByRole('region', { name, exact: true });
      await expect(panel).toContainText('Completed reader favorite');
      await expect
        .poll(() =>
          page.evaluate((label) => {
            const shelf = document.querySelector('[aria-label="Full collection"]');
            const panel = document.querySelector(`[aria-label="${label}"]`);
            return panel.getBoundingClientRect().top >= shelf.getBoundingClientRect().bottom;
          }, name),
        )
        .toBe(true);
    }
    const discovery = page.getByRole('region', { name: `Discover ${category}`, exact: true });
    expect((await discovery.boundingBox()).width).toBeGreaterThanOrEqual(shelfBox.width - 1);
    await expect
      .poll(() =>
        page.evaluate(
          () => JSON.parse(localStorage.getItem('yoru:reader-integration-modes:guest:v1')).yoru,
        ),
      )
      .toBe('core');
    await page.goto(`/browse/${category}?genre=Fantasy`);
    await expect(page.getByRole('region', { name: 'Catalog filters', exact: true })).toBeVisible();
    await expect(page.locator('.reader-catalog')).toHaveCount(0);
    expect(nativeRequests).toEqual([]);
    await page.goto('/settings');
    const selector = page
      .locator('.reader-connection')
      .getByRole('combobox', { name: 'Catalog integration', exact: true });
    await expect(selector).toHaveValue('core');
    await selector.selectOption('extensions');
    await expect(selector).toHaveValue('extensions');
    await navigateCollection(page, category === 'manga' ? 'Manga' : 'Manhwa');
    await expect(hero).toBeVisible();
    await expect(page.locator('.reader-catalog')).toHaveCount(0);
    expect(nativeRequests).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(
      false,
    );
  });
}
