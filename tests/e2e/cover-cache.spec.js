import { test, expect } from '@playwright/test';

test.use({ serviceWorkers: 'allow' });

test('public cover bytes persist across reloads and are served offline', async ({
  page,
  context,
  baseURL,
}) => {
  const cover = 'https://cdn.myanimelist.net/images/manga/5/260006l.webp';
  const pixel = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=',
    'base64',
  );
  await context.route('**/*', (route) => {
    if (route.request().url() === cover)
      return route.fulfill({
        status: 200,
        body: pixel,
        headers: {
          'content-type': 'image/png',
          'access-control-allow-origin': '*',
          'cache-control': 'public, max-age=604800',
        },
      });
    return new URL(route.request().url()).origin === baseURL ? route.continue() : route.abort();
  });
  await page.goto('/');
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller)
      await new Promise((resolve) =>
        navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true }),
      );
  });
  const load = () =>
    page.evaluate(
      (url) =>
        new Promise((resolve) => {
          const image = new Image();
          image.onload = () => resolve(image.naturalWidth);
          image.onerror = () => resolve(0);
          image.src = url;
        }),
      cover,
    );
  expect(await load()).toBeGreaterThan(0);
  await expect
    .poll(() =>
      page.evaluate(
        async (url) => Boolean(await (await caches.open('yoru-public-covers-v1')).match(url)),
        cover,
      ),
    )
    .toBe(true);
  await page.reload();
  await page.evaluate(() => navigator.serviceWorker.ready);
  await context.setOffline(true);
  try {
    expect(await load()).toBeGreaterThan(0);
  } finally {
    await context.setOffline(false);
  }
});
