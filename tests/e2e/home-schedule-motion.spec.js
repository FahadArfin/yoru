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
        items: [27, 28, 29].map((day) => ({
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
  await expect(tuesday.locator('small')).toHaveCSS('opacity', '1');
  await expect(schedule.getByRole('button', { name: /^Wed/ }).locator('small')).toHaveCSS(
    'opacity',
    '0',
  );
  await schedule.getByRole('button', { name: /^Wed/ }).click();
  await schedule.getByRole('button', { name: /^Thu/ }).click();
  await expect(schedule.getByRole('link', { name: /Show 29/ })).toBeVisible();
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
test('reduced motion changes the schedule without running reveal animations', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  const schedule = page.getByRole('region', { name: 'Airing schedule', exact: true });
  await schedule.getByRole('button', { name: /^Wed/ }).click();
  await expect(schedule.getByRole('link', { name: /Show 28/ })).toBeVisible();
  expect(
    await schedule
      .locator('.home-schedule-results')
      .evaluate((node) => node.getAnimations().length),
  ).toBe(0);
});
