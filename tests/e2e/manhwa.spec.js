import { test, expect } from '@playwright/test';

test('manhwa discovery has independent feeds, working hero controls and catalog search', async ({
  page,
  context,
  baseURL,
}) => {
  await context.route('**/*', (route) =>
    new URL(route.request().url()).origin === baseURL ? route.continue() : route.abort(),
  );
  await page.route('**/api/manhwa/discovery?**', async (route) => {
    const params = new URL(route.request().url()).searchParams;
    const mode = params.get('mode'),
      period = params.get('period');
    await route.fulfill({
      json: {
        mode,
        period,
        state: 'ready',
        category: 'MANHWA',
        caption: period === 'month' ? 'September 2026 releases' : 'Manhwa picks',
        items:
          mode === 'trending'
            ? []
            : Array.from({ length: 8 }, (_, i) => ({
                id: `mal-manga-${121496 + i}`,
                title: `${mode} ${period} manhwa ${i + 1}`,
                category: 'MANHWA',
                cover: '/icon.svg',
                year: 2026,
                startDate: '2026-09-01',
                status: 'Finished',
              })),
      },
    });
  });
  await page.goto('/browse/manhwa');
  const hero = page.getByRole('region', { name: 'Featured manhwa', exact: true });
  await expect(hero.getByRole('heading', { name: 'popular all manhwa 1' })).toBeVisible();
  await expect(hero.locator('.weekly-dot')).toHaveCount(8);
  await hero.getByRole('button', { name: 'Next featured manhwa' }).click();
  await expect(hero.getByRole('link', { name: 'Explore manhwa', exact: true })).toHaveAttribute(
    'href',
    '/title/mal-manga-121497',
  );
  await page.getByRole('tab', { name: 'Most popular', exact: true }).click();
  const panel = page.getByRole('tabpanel', { name: 'Most popular', exact: true });
  await panel.getByRole('button', { name: 'Last month' }).click();
  await expect(panel.getByRole('link', { name: /popular month manhwa 1/ })).toBeVisible();
  await page.getByRole('tab', { name: /Trending/ }).click();
  await expect(
    page
      .getByRole('tabpanel', { name: /Trending/ })
      .getByText('Manhwa appear here as visitors open their reading pages.'),
  ).toBeVisible();
  await page.getByLabel('Search catalog').fill('Solo Leveling');
  await page.locator('.inline-search').getByRole('button', { name: 'Search', exact: true }).click();
  await expect(page).toHaveURL(/\/browse\/manhwa\?q=Solo/);
  await expect(page.getByRole('link', { name: 'View Solo Leveling', exact: true })).toHaveAttribute(
    'href',
    '/title/mal-manga-121496',
  );
  await expect(hero).toHaveCount(0);
  await page.getByRole('link', { name: '← Manhwa discovery' }).click();
  await expect(hero).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  await expect(page.locator('.sidebar')).toBeHidden();
  await page.goto('/browse/manga');
  await expect(page.getByRole('region', { name: 'Featured manga', exact: true })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'New series', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
});

test('reading manhwa records readership without requesting anime sources', async ({
  page,
  context,
  baseURL,
}) => {
  await context.route('**/*', (route) =>
    new URL(route.request().url()).origin === baseURL ? route.continue() : route.abort(),
  );
  let readers = 0,
    players = 0;
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.pathname.endsWith('/read-view')) {
      expect(url.searchParams.get('destination')).toBe('yoru');
      expect(url.searchParams.get('selectionFingerprint')).toBeTruthy();
      readers++;
    }
    if (request.url().includes('/sources?')) players++;
  });
  await page.goto('/read/mal-manga-121496/1');
  await expect.poll(() => readers).toBeGreaterThan(0);
  expect(players).toBe(0);
});
