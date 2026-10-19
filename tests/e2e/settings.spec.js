import { test, expect } from '@playwright/test';

test.beforeEach(async ({ context, page, baseURL }) => {
  await page.route('**/api/reader/catalogs', (route) => route.fulfill({ json: { sources: [] } }));
  await context.route('**/*', (route) =>
    new URL(route.request().url()).origin === baseURL ? route.continue() : route.abort(),
  );
  await page.route('**/api/config', (route) =>
    route.fulfill({ json: { realtime: {}, auth: { discord: false } } }),
  );
});

test('settings preserves device preferences and guest navigation', async ({ page }, testInfo) => {
  await page.goto('/settings');
  await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sign in to connect' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Import or export your library' })).toHaveAttribute(
    'href',
    '/library',
  );
  const motion = page.getByRole('checkbox', { name: 'Reduce motion' });
  await motion.check();
  await expect(page.locator('html')).toHaveAttribute('data-reduce-motion', 'true');
  await page.reload();
  await expect(motion).toBeChecked();
  await motion.uncheck();
  await expect(page.locator('html')).toHaveAttribute('data-reduce-motion', 'false');
  await page.getByText('How favorites are imported', { exact: true }).click();
  await expect(page.getByText(/MAL’s regular API and XML exports omit favorites/)).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  await page.screenshot({
    path: testInfo.outputPath('settings-phone-or-desktop.png'),
    fullPage: true,
  });
  await page.getByRole('button', { name: 'Sign in to connect' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
});

test('settings recovers connection status and preserves MAL actions', async ({
  page,
}, testInfo) => {
  await page.route('**/api/auth/me', (route) =>
    route.fulfill({
      json: { user: { id: 'settings-user', name: 'Yoru Reader', email: 'reader@example.test' } },
    }),
  );
  await page.route('**/api/library', (route) => route.fulfill({ json: { items: [] } }));
  await page.route('**/api/reader/preferences', (route) =>
    route.fulfill({ json: { owner: 'settings-user', overrides: {} } }),
  );
  let failed = true;
  let connected = true;
  let syncs = 0;
  let disconnects = 0;
  await page.route('**/api/mal/status', (route) =>
    route.fulfill(
      failed
        ? { status: 503, json: { error: 'Connection status is temporarily unavailable.' } }
        : { json: { configured: true, connected, username: 'Reader', lastSyncedAt: null } },
    ),
  );
  await page.route('**/api/mal/sync', (route) => {
    syncs++;
    return route.fulfill({ json: { imported: 5 } });
  });
  await page.route('**/api/mal/disconnect', (route) => {
    connected = false;
    disconnects++;
    return route.fulfill({ json: { ok: true } });
  });
  await page.goto('/settings');
  await expect(page.getByRole('alert')).toContainText(
    'Connection status is temporarily unavailable.',
  );
  failed = false;
  await page.getByRole('button', { name: 'Try again', exact: true }).click();
  await expect(page.getByText('Connected as Reader')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sign out', exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('settings-connected.png'), fullPage: true });
  await page.getByRole('button', { name: 'Sync from MAL', exact: true }).click();
  await expect.poll(() => syncs).toBe(1);
  await expect(page.getByRole('button', { name: 'Sync from MAL', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Disconnect', exact: true }).click();
  await expect.poll(() => disconnects).toBe(1);
  await expect(page.getByRole('link', { name: 'Connect MyAnimeList' })).toHaveAttribute(
    'href',
    '/api/mal/connect',
  );
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
});
