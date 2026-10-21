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
    await expect(page.getByRole('tab', { name: 'New series', exact: true })).toBeVisible();
    await expect(page.locator('.reader-catalog')).toHaveCount(0);
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
