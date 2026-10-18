import { test, expect } from '@playwright/test';
test.beforeEach(async ({ page, context, baseURL }) => {
  await context.route('**/*', (route) =>
    new URL(route.request().url()).origin === baseURL ? route.continue() : route.abort(),
  );
  await page.clock.install({ time: new Date('2026-10-27T16:00:00Z') });
  await page.route('**/api/home?**', (route) =>
    route.fulfill({ json: { hot: [], releases: [], state: 'ready' } }),
  );
  await page.route('**/api/calendar?**', (route) =>
    route.fulfill({
      json: {
        state: 'ready',
        items: [26, 27, 28, 29].map((day) => ({
          id: `day-${day}`,
          title: `Show ${day}`,
          airType: 'sub',
          airingAt: `2026-10-${day}T17:00:00Z`,
          episode: 1,
          cover: '/icon.svg',
          providerUrl: 'https://animeschedule.net/anime/test',
        })),
      },
    }),
  );
});
test('schedule emphasizes only the selected date and rapid day changes settle on the last selection', async ({
  page,
}) => {
  await page.goto('/');
  const schedule = page.getByRole('region', { name: 'Airing schedule', exact: true });
  const tuesday = schedule.getByRole('button', { name: /^Tue/ });
  await expect(tuesday).toHaveAttribute('aria-pressed', 'true');
  await expect(schedule.locator('.rail-days button').nth(1)).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(tuesday.locator('small')).toHaveCSS('opacity', '1');
  await expect(schedule.locator('.is-yesterday')).toContainText('Yesterday');
  await schedule.getByRole('button', { name: 'Mon, Oct 26', exact: true }).click();
  await expect(schedule.getByRole('link', { name: /Show 26/ })).toBeVisible();
  await expect(schedule.getByRole('link', { name: /Show 26/ })).toContainText('Aired');
  await tuesday.click();
  await expect(schedule.getByRole('button', { name: /^Wed/ }).locator('small')).toHaveCSS(
    'opacity',
    '0',
  );
  await schedule.getByRole('button', { name: /^Wed/ }).click();
  await schedule.getByRole('button', { name: /^Thu/ }).click();
  await expect(schedule.getByRole('link', { name: /Show 29/ })).toBeVisible();
  await expect(schedule.locator('.rail-days button span')).toHaveText([
    'Mon',
    'Thu',
    'Fri',
    'Sat',
    'Sun',
    'Mon',
    'Tue',
    'Wed',
  ]);
  const firstDay = await schedule.locator('.rail-days button').first().boundingBox();
  const lastDay = await schedule.locator('.rail-days button').last().boundingBox();
  expect(firstDay.x).toBeLessThan(lastDay.x);
  await expect(schedule.getByRole('link', { name: /Show 28/ })).toHaveCount(0);
  await expect(schedule.locator('.home-schedule-results')).toHaveAttribute('aria-busy', 'false');
  await schedule.getByRole('button', { name: /^Fri/ }).click();
  await expect(schedule).toContainText('No episodes in this selection.');
  await tuesday.click();
  await expect(schedule.getByRole('link', { name: /Show 27/ })).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  ).toBeTruthy();
});

test('yesterday remains available across a week boundary and uses the actual past date', async ({
  page,
}) => {
  await page.clock.setFixedTime(new Date('2026-11-02T16:00:00Z'));
  await page.route('**/api/calendar?**', (route) =>
    route.fulfill({
      json: {
        state: 'ready',
        items: [
          {
            id: 'yesterday',
            title: 'Sunday episode',
            airType: 'sub',
            episode: 3,
            airingAt: '2026-11-01T17:00:00Z',
            cover: '/icon.svg',
            providerUrl: 'https://animeschedule.net/anime/test',
          },
        ],
      },
    }),
  );
  await page.goto('/');
  const schedule = page.getByRole('region', { name: 'Airing schedule', exact: true });
  await expect(schedule.getByRole('button', { name: 'Mon, Nov 2', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await schedule.getByRole('button', { name: 'Sun, Nov 1', exact: true }).click();
  await expect(schedule.getByRole('link', { name: /Sunday episode/ })).toContainText('Aired');
  await expect(schedule.getByRole('button', { name: 'Sun, Nov 8', exact: true })).toHaveAttribute(
    'aria-pressed',
    'false',
  );
});
test('reduced motion changes the schedule without running reveal animations', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  const schedule = page.getByRole('region', { name: 'Airing schedule', exact: true });
  await schedule.getByRole('button', { name: /^Wed/ }).click();
  await expect(schedule.getByRole('link', { name: /Show 28/ })).toBeVisible();
  await expect(schedule.locator('.rail-days button').nth(1)).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  expect(
    await schedule
      .locator('.rail-days')
      .evaluate((node) => node.getAnimations({ subtree: true }).length),
  ).toBe(0);
  expect(
    await schedule
      .locator('.home-schedule-results')
      .evaluate((node) => node.getAnimations().length),
  ).toBe(0);
});
