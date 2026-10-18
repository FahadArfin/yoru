import { test, expect } from '@playwright/test';
import { fileURLToPath } from 'node:url';

for (const category of ['anime', 'manga', 'manhwa']) {
  test(`${category} banners rotate every 30 seconds, drag in both directions, and respect motion preferences`, async ({
    page,
    context,
    baseURL,
    isMobile,
  }) => {
    await context.route('**/*', (route) =>
      new URL(route.request().url()).origin === baseURL ? route.continue() : route.abort(),
    );
    const items = [1, 2, 3].map((number) => ({
      id: `mal-${category === 'anime' ? 'anime' : 'manga'}-${number}`,
      title: `Carousel story ${number}`,
      category: category.toUpperCase(),
      banner: '/carousel-art.png',
      cover: '/icon.svg',
      genres: ['Adventure'],
    }));
    await page.route('**/carousel-art.png', (route) =>
      route.fulfill({ path: fileURLToPath(new URL('../fixtures/banner-4k.png', import.meta.url)) }),
    );
    await page.route('**/api/home?**', (route) =>
      route.fulfill({ json: { state: 'ready', hot: items, releases: [] } }),
    );
    await page.route('**/api/{manga,manhwa}/discovery?**', (route) =>
      route.fulfill({ json: { state: 'ready', items } }),
    );
    await page.clock.install();
    await page.goto(`/?category=${category}`);
    const hero = page.locator('.weekly-hero');
    const heading = (number) =>
      hero.getByRole('heading', { name: `Carousel story ${number}`, exact: true });
    await expect(heading(1)).toBeVisible();
    await page.clock.pauseAt(new Date(Date.now() + 1000));
    const next = hero.getByRole('button', {
      name: category === 'anime' ? 'Next featured title' : `Next featured ${category}`,
      exact: true,
    });
    await page.locator('.weekly-hero').hover();
    await next.click();
    await expect(heading(2)).toBeVisible();
    await page.getByRole('combobox', { name: 'Search anime, manga, and manhwa' }).click();
    await page.clock.runFor(29999);
    await expect(heading(2)).toBeVisible();
    await page.clock.runFor(1);
    await expect(heading(3)).toBeVisible();
    await page.clock.runFor(900);
    const frame = await hero.boundingBox();
    const drag = async (direction) => {
      const x = frame.width * 0.5,
        y = frame.y + frame.height * 0.45;
      await page.mouse.move(x, y);
      await page.mouse.down();
      await page.mouse.move(x + direction * 150, y, { steps: 8 });
      await expect(hero).toHaveClass(/is-dragging/);
      expect(
        await hero
          .locator('.hero-art-stack')
          .evaluate((el) => new DOMMatrixReadOnly(getComputedStyle(el).transform).m41),
      ).toBeCloseTo(direction * 150, 0);
      const neighbor = hero.locator(`.hero-art-neighbor.${direction < 0 ? 'next' : 'previous'}`);
      const bounds = await neighbor.boundingBox();
      expect(bounds.x).toBeLessThan(frame.width);
      expect(bounds.x + bounds.width).toBeGreaterThan(0);
      await page.mouse.up();
      await page.clock.runFor(450);
    };
    await drag(-1);
    await expect(heading(1)).toBeVisible();
    await drag(1);
    await expect(heading(3)).toBeVisible();
    await page.mouse.move(frame.width * 0.5, frame.y + frame.height * 0.45);
    await page.mouse.down();
    await page.mouse.move(frame.width * 0.5 + 25, frame.y + frame.height * 0.45);
    await page.mouse.up();
    await page.clock.runFor(500);
    await expect(heading(3)).toBeVisible();
    await expect(hero).not.toHaveClass(/is-settling/);
    await expect
      .poll(() =>
        hero
          .locator('.hero-art-stack')
          .evaluate((el) => new DOMMatrixReadOnly(getComputedStyle(el).transform).m41),
      )
      .toBe(0);
    if (isMobile) {
      const touch = await context.newCDPSession(page);
      const swipe = async (direction) => {
        const x = frame.width * 0.5;
        const y = frame.y + frame.height * 0.45;
        await touch.send('Input.dispatchTouchEvent', {
          type: 'touchStart',
          touchPoints: [{ x, y }],
        });
        for (let step = 1; step <= 6; step++) {
          await touch.send('Input.dispatchTouchEvent', {
            type: 'touchMove',
            touchPoints: [{ x: x + direction * step * 25, y }],
          });
        }
        await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        await page.clock.runFor(450);
      };
      await swipe(-1);
      await expect(heading(1)).toBeVisible();
      await swipe(1);
      await expect(heading(3)).toBeVisible();
      await touch.detach();
    }
    await page.locator('.weekly-hero').hover();
    await hero.getByRole('button', { name: 'Pause banner rotation', exact: true }).click();
    await page.getByRole('combobox', { name: 'Search anime, manga, and manhwa' }).click();
    await page.clock.runFor(60000);
    await expect(heading(3)).toBeVisible();
    await page.locator('.weekly-hero').hover();
    await hero.getByRole('button', { name: 'Resume banner rotation', exact: true }).click();
    await page.getByRole('combobox', { name: 'Search anime, manga, and manhwa' }).click();
    await page.clock.runFor(30000);
    await expect(heading(1)).toBeVisible();
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await expect(
      hero.getByRole('button', { name: 'Pause banner rotation', exact: true }),
    ).toHaveCount(0);
    await page.clock.runFor(60000);
    await expect(heading(1)).toBeVisible();
    await page.locator('.weekly-hero').hover();
    await next.click();
    await expect(heading(2)).toBeVisible();
    expect(
      await hero
        .locator('.hero-art-layer.incoming')
        .evaluate((el) => getComputedStyle(el).animationName),
    ).toBe('none');
    const overflow = await page.evaluate(() => ({
      width: innerWidth,
      scroll: document.documentElement.scrollWidth,
      elements: [...document.querySelectorAll('body *')]
        .filter((el) => el.getBoundingClientRect().right > innerWidth + 2)
        .slice(0, 12)
        .map((el) => ({
          tag: el.tagName,
          class: el.className,
          right: el.getBoundingClientRect().right,
        })),
    }));
    expect(overflow.scroll, JSON.stringify(overflow)).toBeLessThanOrEqual(overflow.width);
  });
}
