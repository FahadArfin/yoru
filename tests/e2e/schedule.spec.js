import { test, expect } from '@playwright/test';
test.use({ timezoneId: 'America/New_York', locale: 'en-US' });
const item = (id, airingAt, airType = 'raw', extra = {}) => ({
  id,
  title: id,
  airingAt,
  airType,
  episode: 3,
  cover: '/icon.svg',
  providerUrl: 'https://animeschedule.net/anime/test',
  ...extra,
});

test('animation filters separate family shows, preserve release tracks and survive reload', async ({
  page,
  context,
  baseURL,
}) => {
  await context.route('**/*', (route) =>
    new URL(route.request().url()).origin === baseURL ? route.continue() : route.abort(),
  );
  await page.clock.install({ time: new Date('2026-10-12T12:00:00Z') });
  await page.route('**/api/calendar?**', (route) =>
    route.fulfill({
      json: {
        state: 'ready',
        items: [
          item('Japanese drama', '2026-10-12T15:00:00Z', 'raw', { route: 'drama', donghua: false }),
          item('Doraemon', '2026-10-12T16:00:00Z', 'raw', {
            route: 'doraemon-2005',
            donghua: false,
          }),
          item('Lookism', '2026-10-12T17:00:00Z', 'raw', {
            route: 'gaiken-shijou-shugi',
            donghua: false,
          }),
          item('Chinese adventure', '2026-10-12T18:00:00Z', 'raw', {
            route: 'chinese-adventure',
            donghua: true,
          }),
          item('Chinese dub', '2026-10-12T18:00:00Z', 'dub', {
            route: 'chinese-adventure',
            donghua: true,
          }),
          item('Family TBA', null, 'raw', { route: 'sazae-san' }),
        ],
      },
    }),
  );
  await page.goto('/schedule');
  const filter = page.getByRole('group', { name: 'Animation category' });
  await expect(filter.getByRole('button', { name: 'Japanese', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page.locator('.schedule-list h3')).toHaveText(['Japanese drama']);
  await filter.getByRole('button', { name: 'Cartoons', exact: true }).click();
  await expect(page.locator('.schedule-list h3')).toHaveText(['Doraemon', 'Family TBA']);
  await expect(page.locator('.schedule-day-heading')).toContainText('1 releases');
  await filter.getByRole('button', { name: 'Korean', exact: true }).click();
  await expect(page.locator('.schedule-list h3')).toHaveText(['Lookism']);
  await filter.getByRole('button', { name: 'Chinese', exact: true }).click();
  await expect(page.locator('.schedule-list h3')).toHaveText(['Chinese adventure']);
  await page.getByRole('button', { name: 'English dub', exact: true }).click();
  await expect(page.locator('.schedule-list h3')).toHaveText(['Chinese dub']);
  await page.reload();
  await expect(filter.getByRole('button', { name: 'Chinese', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page.locator('.schedule-list h3')).toHaveText(['Chinese adventure']);
  await filter.getByRole('button', { name: 'All', exact: true }).click();
  await expect(page.locator('.schedule-list h3')).toHaveCount(5);
  await page.goto('/schedule?animation=invalid');
  await expect(filter.getByRole('button', { name: 'Japanese', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
test('schedule groups local dates, sorts times, filters releases and identifies delays', async ({
  page,
  context,
  baseURL,
}, testInfo) => {
  await context.route('**/*', (route) =>
    new URL(route.request().url()).origin === baseURL ? route.continue() : route.abort(),
  );
  await page.clock.install({ time: new Date('2026-10-12T12:00:00Z') });
  await page.route('**/api/calendar?**', (route) =>
    route.fulfill({
      json: {
        state: 'ready',
        updatedAt: '2026-10-12T12:00:00Z',
        items: [
          item('Later show', '2026-10-12T20:00:00Z'),
          item('Tokyo Tuesday', '2026-10-13T00:30:00+09:00'),
          item('Sunday in New York', '2026-10-12T00:30:00+09:00'),
          item('Dub show', '2026-10-12T19:00:00Z', 'dub'),
          item('Delayed show', null, 'raw', {
            delayed: true,
            delayNote: 'On break',
            delayedUntil: '2026-10-19T15:00:00Z',
          }),
        ],
      },
    }),
  );
  await page.goto('/schedule');
  await expect(page.getByText('America/New York')).toBeVisible();
  await expect(page.locator('.schedule-list').first().locator('h3')).toHaveText([
    'Tokyo Tuesday',
    'Later show',
  ]);
  await expect(page.locator('.schedule-list').first().locator('time')).toHaveText([
    '11:30 AM',
    '4:00 PM',
  ]);
  await expect(page.getByText('Sunday in New York')).toHaveCount(0);
  await expect(page.getByText('In 3h 30m')).toBeVisible();
  await expect(page.getByText('Delayed · On break', { exact: false })).toBeVisible();
  await expect(page.locator('.schedule-delay-target')).toContainText(
    'Delayed until Oct 19, 11:00 AM EDT',
  );
  await page.screenshot({ path: testInfo.outputPath('schedule-populated.png'), fullPage: true });
  await page.getByRole('button', { name: 'English dub', exact: true }).click();
  await expect(page.locator('.schedule-list h3')).toHaveText(['Dub show']);
  await page.getByRole('button', { name: 'Broadcast', exact: true }).click();
  await page.getByRole('button', { name: 'Previous week' }).click();
  await page.locator('.schedule-days button').last().click();
  await expect(page.getByRole('heading', { name: 'Sunday in New York' })).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
  expect(overflow).toBe(false);
});
test('unavailable schedule explains failure without claiming no releases', async ({
  page,
  context,
  baseURL,
}) => {
  await context.route('**/*', (route) =>
    new URL(route.request().url()).origin === baseURL ? route.continue() : route.abort(),
  );
  await page.route('**/api/calendar?**', (route) =>
    route.fulfill({ json: { state: 'unavailable', items: [], updatedAt: null } }),
  );
  await page.goto('/schedule');
  await expect(page.getByText('The schedule is temporarily unavailable.')).toBeVisible();
  await expect(page.getByText('A little breathing room.')).toHaveCount(0);
  await page.route('**/api/calendar?**', (route) =>
    route.fulfill({
      json: {
        state: 'stale',
        items: [item('Saved show', null)],
        updatedAt: '2026-10-12T12:00:00Z',
      },
    }),
  );
  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(
    page.getByText('Showing the last saved times. Some updates may be missing.'),
  ).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Saved show' })).toBeVisible();
});
