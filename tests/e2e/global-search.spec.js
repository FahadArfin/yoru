import { test, expect } from '@playwright/test';

test.beforeEach(async ({ context, baseURL }) => {
  await context.route('**/*', (route) =>
    new URL(route.request().url()).origin === baseURL ? route.continue() : route.abort(),
  );
});

test('saved matches stay visible while live suggestions update and empty searches are honest', async ({
  page,
}) => {
  let calls = 0;
  await page.route('**/api/search/suggestions?**', (route) => {
    const q = new URL(route.request().url()).searchParams.get('q');
    if (q === 'nothing') return route.fulfill({ json: { items: [], pending: false } });
    calls++;
    return route.fulfill({
      json: {
        items: [
          { id: 'mal-anime-16498', title: 'Attack on Titan', category: 'ANIME' },
          ...(calls > 1
            ? [{ id: 'mal-anime-25777', title: 'Attack on Titan Season 2', category: 'ANIME' }]
            : []),
        ],
        pending: calls === 1,
      },
    });
  });
  await page.goto('/');
  const search = page.getByRole('combobox', { name: 'Search anime, manga, and manhwa' });
  await search.fill('attack');
  await expect(page.getByRole('option').first()).toContainText('Attack on Titan');
  await expect(page.locator('.search-status')).toHaveText('Updating matches…');
  await expect(page.getByRole('option')).toHaveCount(2);
  await search.fill('nothing');
  await expect(page.getByRole('option')).toHaveCount(0);
  await expect(page.locator('.search-status')).toContainText('No titles found');
  await search.press('Enter');
  await expect(page).toHaveURL(/\/browse\/all\?q=nothing/);
});

test('search shows ranked covers, category filters and navigable suggestions without submitting', async ({
  page,
  isMobile,
}) => {
  await page.goto('/');
  const search = page.getByRole('combobox', { name: 'Search anime, manga, and manhwa' });
  await search.fill('attack on titan');
  const list = page.getByRole('listbox', { name: 'Suggested titles' });
  await expect(list.getByRole('option').first()).toContainText('Attack on Titan');
  await expect(list.getByRole('option').first().locator('img')).toBeVisible();
  const panel = await page.locator('.search-panel').boundingBox();
  const field = await page.getByRole('search').boundingBox();
  expect(Math.abs(panel.y - field.y - field.height - 8)).toBeLessThan(2);
  if (!isMobile) {
    expect(Math.abs(panel.x - field.x)).toBeLessThan(2);
    expect(Math.abs(panel.width - field.width)).toBeLessThan(2);
  }
  expect(panel.x).toBeGreaterThanOrEqual(0);
  expect(panel.x + panel.width).toBeLessThanOrEqual(page.viewportSize().width);
  await expect(page.getByText('Find your next story', { exact: true })).toHaveCount(0);
  await expect(page.getByText(/\d+ matching titles/)).toHaveCount(0);
  await page.locator('.search-filters').getByRole('button', { name: 'Manga', exact: true }).click();
  await expect(list.getByRole('option').first()).toContainText('manga');
  await expect(list.getByRole('option').first()).toHaveAttribute('href', /\/title\/mal-manga-/);
  await search.press('Escape');
  await expect(list).toHaveCount(0);
  await search.press('ArrowDown');
  await expect(list).toBeVisible();
  await expect(list.getByRole('option').first()).toBeVisible();
  await search.press('ArrowDown');
  await expect(search).toHaveAttribute('aria-activedescendant', /search-option-/);
  await search.press('Enter');
  await expect(page).toHaveURL(/\/title\/mal-manga-/);
  await expect(list).toHaveCount(0);
});

test('search ignores stale responses, clears, and supports all-results and retry', async ({
  page,
}) => {
  let fail = false;
  let releaseOld;
  await page.route('**/api/search/suggestions?**', async (route) => {
    const q = new URL(route.request().url()).searchParams.get('q');
    if (q === 'old')
      await new Promise((resolve) => {
        releaseOld = resolve;
      });
    if (fail) return route.fulfill({ status: 503, json: { error: 'Unavailable' } });
    await route
      .fulfill({
        json: {
          items: [
            {
              id: 'mal-anime-16498',
              title: `${q} match`,
              category: 'ANIME',
              cover: '/icon.svg',
              year: 2013,
              format: 'TV',
              episodes: 25,
            },
          ],
          pending: false,
        },
      })
      .catch(() => {});
  });
  await page.goto('/');
  const search = page.getByRole('combobox', { name: 'Search anime, manga, and manhwa' });
  await search.fill('old');
  await expect.poll(() => Boolean(releaseOld)).toBe(true);
  await search.fill('new');
  await expect(page.getByRole('option')).toContainText('new match');
  releaseOld();
  await expect(page.getByRole('option')).toContainText('new match');
  await search.press('Escape');
  await expect(page.locator('.search-panel')).toHaveCount(0);
  await search.click();
  await expect(page.locator('.search-panel')).toBeVisible();
  const size = await page.evaluate(() => ({
    width: innerWidth,
    scroll: document.documentElement.scrollWidth,
  }));
  expect(size.scroll).toBeLessThanOrEqual(size.width);
  await page.getByRole('link', { name: 'Yoru home', exact: true }).first().focus();
  await expect(page.locator('.search-panel')).toBeVisible();
  await search.fill('new');
  await page.getByRole('button', { name: 'Clear search', exact: true }).click();
  await expect(search).toHaveValue('');
  await expect(page.locator('.search-panel')).toHaveCount(0);
  fail = true;
  await search.fill('retry');
  await page.getByRole('button', { name: 'Retry search', exact: true }).waitFor();
  fail = false;
  await page.getByRole('button', { name: 'Retry search', exact: true }).click();
  await expect(page.getByRole('option')).toContainText('retry match');
  await page.getByRole('link', { name: 'View all results', exact: true }).click();
  await expect(page).toHaveURL(/\/browse\/all\?q=retry/);
});

test('suggestions persist while idle and scrolling results, but page scroll dismisses without clearing the query', async ({
  page,
}) => {
  await page.route('**/api/search/suggestions?**', (route) =>
    route.fulfill({
      json: {
        items: Array.from({ length: 12 }, (_, i) => ({
          id: `mal-anime-${16498 + i}`,
          title: `Attack result ${i + 1}`,
          category: 'ANIME',
          cover: '/icon.svg',
        })),
        pending: false,
      },
    }),
  );
  await page.goto('/');
  const search = page.getByRole('combobox', { name: 'Search anime, manga, and manhwa' });
  await search.fill('attack');
  const list = page.getByRole('listbox', { name: 'Suggested titles' });
  await expect(list.getByRole('option')).toHaveCount(12);
  await search.press('Tab');
  await page.waitForTimeout(1200);
  await expect(list).toBeVisible();
  await list.evaluate((el) => {
    el.scrollTop = 250;
  });
  await expect.poll(() => list.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
  await expect(list).toBeVisible();
  await page.evaluate(() => window.scrollTo({ top: 350, behavior: 'instant' }));
  await expect(list).toHaveCount(0);
  await expect(search).toHaveValue('attack');
  await search.click();
  await expect(list).toBeVisible();
  await list.getByRole('option').first().click();
  await expect(page).toHaveURL(/\/title\/mal-anime-16498$/);
});
