import { test, expect } from '@playwright/test';

for (const category of ['manga', 'manhwa']) {
  test(`${category} features full-width selected artwork with a cover fallback`, async ({
    page,
    context,
    baseURL,
  }) => {
    await context.route('**/*', (route) =>
      new URL(route.request().url()).origin === baseURL ? route.continue() : route.abort(),
    );
    await page.route('**/test-reading-art/**', (route) => {
      const name = new URL(route.request().url()).pathname;
      if (name.includes('broken')) return route.fulfill({ status: 404, body: '' });
      const landscape = name.includes('landscape');
      return route.fulfill({
        contentType: 'image/svg+xml',
        body: `<svg xmlns="http://www.w3.org/2000/svg" width="${landscape ? 1400 : 800}" height="${landscape ? 600 : 1200}"><rect width="100%" height="100%" fill="#356063"/></svg>`,
      });
    });
    await page.route(`**/api/${category}/discovery?**`, (route) =>
      route.fulfill({
        json: {
          state: 'ready',
          items: ['landscape', 'portrait', 'broken'].map((art, i) => ({
            id: `mal-manga-${i + 1}`,
            title: `${category} story ${i + 1}`,
            category: category.toUpperCase(),
            cover: `/test-reading-art/cover-${i + 1}.svg`,
            banner: `/test-reading-art/${art}.svg`,
          })),
        },
      }),
    );
    await page.goto(`/browse/${category}`);
    const hero = page.getByRole('region', { name: `Featured ${category}`, exact: true });
    const backdrop = hero.locator('.hero-art-layer:not(.outgoing) .weekly-backdrop');
    await expect(backdrop).toHaveAttribute('src', '/test-reading-art/landscape.svg');
    const checkFullWidth = async (image) => {
      const frame = await hero.boundingBox();
      const art = await image.boundingBox();
      const viewport = page.viewportSize();
      expect(frame.x).toBe(0);
      expect(frame.width).toBeGreaterThan(viewport.width * 0.98);
      expect(frame.height).toBeGreaterThan(viewport.height * 0.75);
      expect(art.width).toBeCloseTo(frame.width, 0);
      expect(art.height).toBeCloseTo(frame.height, 0);
      expect(await image.evaluate((el) => getComputedStyle(el).objectFit)).toBe('cover');
    };
    await checkFullWidth(backdrop);
    await expect(hero.getByRole('heading', { name: `${category} story 1` })).toBeVisible();
    await page.emulateMedia({ reducedMotion: 'reduce' });
    expect(await backdrop.evaluate((el) => getComputedStyle(el).animationName)).toBe('none');

    for (const number of [2, 3]) {
      await hero.getByRole('button', { name: `Next featured ${category}` }).click();
      await expect(
        hero.getByRole('heading', { name: `${category} story ${number}` }),
      ).toBeVisible();
      await expect(
        hero.getByRole('link', { name: `Explore ${category}`, exact: true }),
      ).toHaveAttribute('href', `/title/mal-manga-${number}`);
      await expect(backdrop).toHaveCount(0);
      const cover = hero.locator('.hero-art-layer:not(.outgoing) .manga-cover-stage img');
      await expect(cover).toHaveAttribute('src', `/test-reading-art/cover-${number}.svg`);
      await expect(cover).toHaveAttribute('data-cover-state', 'ready');
      await checkFullWidth(cover);
    }
    await hero.getByRole('button', { name: `Next featured ${category}` }).click();
    await expect(backdrop).toHaveAttribute('src', '/test-reading-art/landscape.svg');
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(
      false,
    );
  });
}
