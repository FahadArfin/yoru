import { test, expect } from '@playwright/test';
test.use({ timezoneId: 'America/New_York', locale: 'en-US' });
const release = (id, extra = {}) => ({
  id,
  title: id,
  chapter: '4',
  chapterTitle: 'A new day',
  language: 'en',
  publishedAt: '2026-10-18T05:30:00Z',
  cover: '/cover-placeholder.svg',
  mediaId: 'mal-manga-123',
  providerUrl: 'https://mangadex.org/chapter/test',
  groups: ['Example group'],
  ...extra,
});

test('chapter calendar switches categories, dates and languages without losing the anime schedule', async ({
  page,
  context,
  baseURL,
}, testInfo) => {
  await context.route('**/*', (route) =>
    new URL(route.request().url()).origin === baseURL ? route.continue() : route.abort(),
  );
  await page.clock.install({ time: new Date('2026-10-18T12:00:00Z') });
  await page.route('**/api/calendar?**', (route) =>
    route.fulfill({ json: { state: 'ready', items: [] } }),
  );
  await page.route('**/api/chapter-calendar?**', (route) => {
    const p = new URL(route.request().url()).searchParams;
    expect(p.get('timezone')).toBe('America/New_York');
    const items =
      p.get('date') === '2026-10-19'
        ? [release('Tomorrow', { publishedAt: '2026-10-19T16:00:00Z' })]
        : p.get('category') === 'manhwa'
          ? [release('Korean series')]
          : p.get('language') === 'all'
            ? [release('Spanish edition', { language: 'es' })]
            : p.get('offset') === '100'
              ? [release('Second page')]
              : [release('First chapter')];
    return route.fulfill({
      json: {
        state: 'ready',
        items,
        nextOffset: p.get('offset') === '0' ? 100 : null,
        updatedAt: '2026-10-18T12:00:00Z',
      },
    });
  });
  await page.goto('/schedule');
  const picker = page.getByRole('group', { name: 'Schedule category' });
  await picker.getByRole('button', { name: 'Manga', exact: true }).click();
  await expect(page).toHaveURL(/category=manga/);
  await expect(page.getByRole('heading', { name: 'Manga release calendar' })).toBeVisible();
  await expect(page.locator('.schedule-list time')).toHaveText(['1:30 AM']);
  await expect(page.getByRole('button', { name: 'English', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page.getByRole('link', { name: 'First chapter', exact: true })).toHaveAttribute(
    'href',
    '/title/mal-manga-123',
  );
  await page.getByRole('button', { name: 'Load more chapters' }).click();
  await expect(page.locator('.schedule-list h3')).toHaveText(['First chapter', 'Second page']);
  await page.getByRole('button', { name: 'All languages', exact: true }).click();
  await expect(page.locator('.schedule-list h3')).toHaveText(['Spanish edition']);
  await expect(page.getByText('Spanish · Ch. 4')).toBeVisible();
  await picker.getByRole('button', { name: 'Manhwa', exact: true }).click();
  await expect(page.locator('.schedule-list h3')).toHaveText(['Korean series']);
  await page.getByRole('button', { name: 'Next week', exact: true }).click();
  await expect(page.getByText('Scheduled on MangaDex', { exact: false })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('chapter-calendar.png'), fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  await picker.getByRole('button', { name: 'Anime', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Airing schedule' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Broadcast', exact: true })).toBeVisible();
});

test('chapter calendar distinguishes unavailable, stale and empty future dates', async ({
  page,
  context,
  baseURL,
}) => {
  await context.route('**/*', (route) =>
    new URL(route.request().url()).origin === baseURL ? route.continue() : route.abort(),
  );
  await page.clock.install({ time: new Date('2026-10-18T12:00:00Z') });
  let state = 'unavailable';
  await page.route('**/api/chapter-calendar?**', (route) =>
    route.fulfill({
      json: { state, items: state === 'stale' ? [release('Saved chapter')] : [], nextOffset: null },
    }),
  );
  await page.goto('/schedule?category=manhwa');
  await expect(page.getByText('Chapter releases are temporarily unavailable.')).toBeVisible();
  await expect(page.getByText('No chapter releases listed.')).toHaveCount(0);
  state = 'stale';
  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(page.getByText('Showing saved chapter releases.')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Saved chapter', exact: true })).toBeVisible();
  state = 'ready';
  await page.getByRole('button', { name: 'Next week', exact: true }).click();
  await expect(page.getByText('No announced chapters yet.')).toBeVisible();
});

test('chapter calendar endpoint is available on both runtimes and validates queries', async ({
  request,
}) => {
  const result = await request.get(
    '/api/chapter-calendar?category=manhwa&language=en&timezone=America%2FNew_York',
  );
  expect(result.ok()).toBe(true);
  expect(await result.json()).toMatchObject({
    category: 'manhwa',
    state: 'unavailable',
    items: [],
  });
  const invalid = await request.get('/api/chapter-calendar?category=anime');
  expect(invalid.status()).toBe(400);
});
