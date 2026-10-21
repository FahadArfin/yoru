import { test, expect } from '@playwright/test';

for (const category of ['manga', 'manhwa']) {
  test(`${category} expands a ranked directory, searches themes, and keeps filters selected`, async ({
    page,
    context,
    baseURL,
  }) => {
    await context.route('**/*', (route) =>
      new URL(route.request().url()).origin === baseURL ? route.continue() : route.abort(),
    );
    await page.goto(`/browse/${category}`);
    const browser = page.getByRole('region', { name: 'Browse all genres and themes' });
    const nav = browser.getByRole('navigation', { name: 'Explore genres' });
    await expect(nav.locator('.genre-count')).toHaveCount(12);
    const counts = await nav.locator('.genre-count').allTextContents();
    expect(counts.map((value) => Number(value.replaceAll(',', '')))).toEqual(
      counts.map((value) => Number(value.replaceAll(',', ''))).sort((a, b) => b - a),
    );
    await browser.getByRole('button', { name: 'Show all genres' }).click();
    await expect(browser.getByRole('button', { name: 'Show fewer genres' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    expect(await nav.locator('.genre-count').count()).toBeGreaterThan(60);
    await browser.getByRole('searchbox', { name: 'Find a genre or theme' }).fill('villainess');
    await expect(nav.getByRole('link')).toHaveCount(1);
    await nav.getByRole('link', { name: /Villainess/ }).click();
    await expect(page).toHaveURL(new RegExp(`/browse/${category}\\?genre=Villainess$`));
    await expect(page.getByLabel('Genre', { exact: true })).toHaveValue('Villainess');
    await page.goBack();
    await browser.getByRole('button', { name: 'Show all genres' }).click();
    await browser.getByRole('searchbox').fill('not-a-genre');
    await expect(browser.getByRole('status')).toHaveText('No matching genres or themes.');
    await browser.getByRole('button', { name: 'Show fewer genres' }).click();
    await expect(nav.locator('.genre-count')).toHaveCount(12);
    expect(await page.locator('.genre-collection').last().getAttribute('aria-label')).toBe(
      'Full collection',
    );
    expect(
      await page.locator('body').evaluate(() => document.documentElement.scrollWidth > innerWidth),
    ).toBe(false);
  });
}
