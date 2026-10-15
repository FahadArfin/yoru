import { test, expect } from '@playwright/test';

test('manga landing preserves all featured titles, filters discovery, and opens the searchable catalog', async ({
  page,
  context,
  baseURL,
  isMobile,
}) => {
  await context.route('**/*', (route) =>
    new URL(route.request().url()).origin === baseURL ? route.continue() : route.abort(),
  );
  const requests = [];
  await page.route('**/api/manga/discovery?**', async (route) => {
    const params = new URL(route.request().url()).searchParams;
    const mode = params.get('mode'),
      period = params.get('period');
    requests.push(`${mode}:${period}`);
    await route.fulfill({
      json: {
        mode,
        period,
        state: 'ready',
        caption: period === 'month' ? 'September 2026 releases' : 'Recently published manga series',
        items: Array.from({ length: 8 }, (_, i) => ({
          id: `mal-manga-${i + 1}`,
          title: `${mode} ${period} manga ${i + 1}`,
          category: 'MANGA',
          cover: '/icon.svg',
          banner: '/icon.svg',
          year: 2026,
          startDate: '2026-09-01',
          status: 'Finished',
          viewers: 12,
        })),
      },
    });
  });
  await page.goto('/browse/manga');
  const hero = page.getByRole('region', { name: 'Featured manga', exact: true });
  await expect(hero.getByRole('heading', { name: 'popular all manga 1' })).toBeVisible();
  await expect(hero.locator('.weekly-dot')).toHaveCount(8);
  await expect(hero.locator('.weekly-backdrop')).toHaveCount(0);
  await hero.getByRole('button', { name: 'Next featured manga' }).click();
  await expect(hero.getByRole('link', { name: 'Explore manga', exact: true })).toHaveAttribute(
    'href',
    '/title/mal-manga-2',
  );
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  const tabs = page.getByRole('tablist', { name: 'Discover manga' });
  await expect(
    page.getByRole('tabpanel', { name: 'New series' }).getByText('Started Sep 2026').first(),
  ).toBeVisible();
  await tabs.getByRole('tab', { name: 'Most popular' }).click();
  let panel = page.getByRole('tabpanel', { name: 'Most popular' });
  await panel.getByRole('button', { name: 'Last month' }).click();
  await expect(panel.getByText('September 2026 releases')).toBeVisible();
  await expect(panel.getByRole('link', { name: /popular month manga 1/ })).toHaveAttribute(
    'href',
    '/title/mal-manga-1',
  );
  await tabs.getByRole('tab', { name: 'Most popular' }).focus();
  await page.keyboard.press('ArrowRight');
  panel = page.getByRole('tabpanel', { name: /Trending/ });
  await expect(panel.getByText('12 readers this week').first()).toBeVisible();
  expect(requests).toContain('trending:week');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  expect(
    await panel
      .locator('.discovery-item')
      .first()
      .evaluate((el) => getComputedStyle(el).animationName),
  ).toBe('none');
  await page.getByLabel('Search catalog').fill('Berserk');
  await page.locator('.inline-search').getByRole('button', { name: 'Search', exact: true }).click();
  await expect(page).toHaveURL(/\/browse\/manga\?q=Berserk/);
  await expect(page.getByRole('link', { name: 'View Berserk', exact: true })).toHaveAttribute(
    'href',
    '/title/mal-manga-2',
  );
  await expect(hero).toHaveCount(0);
  await page.getByRole('link', { name: '← Manga discovery' }).click();
  await expect(hero).toBeVisible();
  await expect(page.locator('.sidebar')).toBeHidden();
  if (isMobile)
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(
      false,
    );
});

test('reading manga records a reader and never requests an anime player', async ({
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
    if (request.url().endsWith('/read-view')) readers++;
    if (request.url().includes('/sources?')) players++;
  });
  await page.goto('/read/mal-manga-21/1');
  await expect.poll(() => readers).toBeGreaterThan(0);
  expect(players).toBe(0);
});
