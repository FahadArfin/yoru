import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page, context, baseURL }) => {
  await context.route('**/*', (route) =>
    new URL(route.request().url()).origin === baseURL ? route.continue() : route.abort(),
  );
  await page.route('**/api/reader/catalogs*', (route) => route.fulfill({ json: { sources: [] } }));
});

for (const persistent of [false, true]) {
  test(`Settings chunk failure ${persistent ? 'stops after one refresh' : 'recovers at the requested URL'}`, async ({
    page,
  }) => {
    let attempts = 0;
    let documents = 0;
    page.on('request', (request) => {
      if (request.isNavigationRequest() && request.frame() === page.mainFrame()) documents++;
    });
    await page.route('**/assets/Settings-*.js', (route) => {
      attempts++;
      return persistent || attempts === 1
        ? route.fulfill({
            status: 404,
            contentType: 'text/plain',
            body: 'Old deployment asset removed',
          })
        : route.continue();
    });
    await page.goto('/browse/anime');
    await page.getByRole('link', { name: 'Settings', exact: true }).click();
    if (persistent) {
      await expect(page.getByRole('button', { name: 'Reload Yoru', exact: true })).toBeVisible();
    } else {
      await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
      await expect(page.locator('.fatal')).toHaveCount(0);
    }
    await expect(page).toHaveURL(/\/settings$/);
    expect(documents).toBe(2);
    expect(attempts).toBe(2);
  });
}

test('ordinary rendering errors keep the fallback without automatic reload', async ({ page }) => {
  let documents = 0;
  page.on('request', (request) => {
    if (request.isNavigationRequest() && request.frame() === page.mainFrame()) documents++;
  });
  await page.route('**/assets/Settings-*.js', (route) =>
    route.fulfill({
      contentType: 'text/javascript',
      body: 'export default function Settings() { throw new Error("Settings render failed"); }',
    }),
  );
  await page.goto('/browse/anime');
  await page.getByRole('link', { name: 'Settings', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Reload Yoru', exact: true })).toBeVisible();
  expect(documents).toBe(1);
});

test('HTML revalidates on both the root and deep links', async ({ request }) => {
  for (const path of ['/', '/settings']) {
    const response = await request.get(path);
    expect(response.ok()).toBe(true);
    expect(response.headers()['content-type']).toContain('text/html');
    const cache = response.headers()['cache-control'] || '';
    // The Sites asset service may serve root HTML before the Worker and emits
    // the equivalent immediate-expiry plus mandatory-revalidation policy.
    expect(
      cache.includes('no-cache') ||
        (/\bmax-age=0\b/.test(cache) && cache.includes('must-revalidate')),
    ).toBe(true);
  }
});
