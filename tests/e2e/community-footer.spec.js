import { test, expect } from '@playwright/test';

test.beforeEach(async ({ context, baseURL }) => {
  await context.route('**/*', (route) =>
    new URL(route.request().url()).origin === baseURL ? route.continue() : route.abort(),
  );
});

test('footer shows real guest presence and accessible panel across catalog and reader routes', async ({
  page,
}) => {
  await page.goto('/settings');
  const footer = page.getByRole('contentinfo', { name: 'Yoru footer' });
  const people = footer.getByRole('button', { name: "See who's online" });
  await expect(people).toContainText(/\d+ online/);
  await people.click();
  const panel = page.getByRole('dialog', { name: 'Online watchers and readers' });
  await expect(panel).toBeVisible();
  await expect(panel).toContainText('Guests');
  await expect(panel.locator('.presence-totals')).toContainText(/[1-9]\d*Guests/);
  await page.keyboard.press('Escape');
  await expect(panel).toHaveCount(0);
  await expect(people).toBeFocused();
  await footer
    .getByRole('navigation', { name: 'Footer explore' })
    .getByRole('link', { name: 'Manga', exact: true })
    .click();
  await expect(page).toHaveURL(/browse\/manga/);
  await expect(footer).toBeAttached();
  await page.goto('/read/mal-manga-121496/1');
  await expect(people).toContainText(/\d+ online/);
  await people.scrollIntoViewIfNeeded();
  await expect(people).toBeVisible();
  await people.click();
  await expect(panel.locator('.presence-activities')).toContainText(/[1-9]\d* reading/);
  await panel.getByRole('button', { name: 'Close dialog' }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('member cards update, guests stay anonymous and disconnected counts are not shown as zero', async ({
  page,
}) => {
  let fail = false;
  await page.route('**/api/presence', (route) =>
    fail
      ? route.fulfill({ status: 503, json: { error: 'Unavailable' } })
      : route.fulfill({
          json: {
            count: 8,
            registered: 2,
            guests: 6,
            watching: 3,
            reading: 4,
            browsing: 1,
            users: [
              { id: 'a', name: 'Mina', avatar: '' },
              { id: 'b', name: 'Kai', avatar: '' },
            ],
          },
        }),
  );
  await page.goto('/settings');
  const footer = page.getByRole('contentinfo', { name: 'Yoru footer' });
  await expect(footer.getByRole('button', { name: "See who's online" })).toContainText('8 online');
  await footer.getByRole('button', { name: "See who's online" }).click();
  const panel = page.getByRole('dialog');
  await expect(panel.locator('.presence-members li')).toHaveCount(2);
  await expect(panel).toContainText('Mina');
  await expect(panel.locator('.presence-totals')).toContainText('6Guests');
  await page.keyboard.press('Escape');
  fail = true;
  await page.goto('/community');
  await footer.getByRole('button', { name: "See who's online" }).click();
  await expect(panel).toContainText('Live status is temporarily unavailable');
  await expect(panel.locator('.presence-totals')).not.toContainText('0');
  await expect(panel.locator('.presence-members li')).toHaveCount(0);
});
