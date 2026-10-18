import { test, expect } from '@playwright/test';

test('discovery collections expand, preserve filters, handle fast switches, and support reduced motion', async ({
  page,
  context,
  baseURL,
}, testInfo) => {
  await context.route('**/*', (route) =>
    new URL(route.request().url()).origin === baseURL ? route.continue() : route.abort(),
  );
  await page.route('**/api/home?**', (route) => {
    const language = new URL(route.request().url()).searchParams.get('language');
    return route.fulfill({
      json: {
        hot: [],
        state: 'ready',
        language,
        releases: [
          {
            id: 'episode',
            title: `${language} episode`,
            airType: language === 'dub' ? 'dub' : 'sub',
            episode: 7,
            media: { id: 'mal-anime-21' },
            cover: '/icon.svg',
            airingAt: new Date().toISOString(),
          },
        ],
      },
    });
  });
  let finishYear;
  let popularRequests = 0;
  await page.route('**/api/home/discovery?**', async (route) => {
    const params = new URL(route.request().url()).searchParams;
    const mode = params.get('mode'),
      period = params.get('period');
    if (mode === 'popular' && period === 'all' && ++popularRequests === 1)
      return route.fulfill({ json: { mode, period, state: 'pending', items: [] } });
    if (period === 'year')
      await new Promise((resolve) => {
        finishYear = resolve;
      });
    await route.fulfill({
      json: {
        mode,
        period,
        state: 'ready',
        caption: period === 'month' ? 'September 2026 releases' : 'All-time favorites',
        items: [
          {
            id: 'mal-anime-21',
            title: `${mode} ${period} pick`,
            year: 2026,
            cover: '/icon.svg',
            viewers: 12,
          },
        ],
      },
    });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'English dub', exact: true }).click();
  const released = page.getByRole('region', { name: 'Just released', exact: true });
  const popular = page.getByRole('region', { name: 'Most popular', exact: true });
  const trending = page.getByRole('region', { name: 'Trending', exact: true });
  await expect(
    released.getByRole('button', { name: 'Just released', exact: true }),
  ).toHaveAttribute('aria-expanded', 'true');
  await expect(popular.locator('.discovery-preview-card')).toHaveCount(1);
  await expect(trending.locator('.discovery-preview-card')).toHaveCount(1);
  for (const category of [popular, trending]) {
    const bounds = await category.boundingBox();
    const card = await category.locator('.discovery-preview-card').boundingBox();
    expect(card.x + card.width).toBeLessThanOrEqual(bounds.x + bounds.width + 1);
  }
  const highlights = await page
    .getByRole('complementary', { name: 'Anime highlights' })
    .boundingBox();
  const discovery = await page.locator('.discovery-panels').boundingBox();
  expect(highlights.y).toBeGreaterThanOrEqual(discovery.y + discovery.height);
  await page
    .locator('.discovery-section')
    .screenshot({ path: testInfo.outputPath('discovery-default.png') });
  await popular.getByRole('button', { name: 'Most popular', exact: true }).click();
  let panel = popular;
  await expect(released.locator('.discovery-preview-card')).toHaveCount(1);
  await expect(page.locator('.discovery-panel.is-expanded')).toHaveCount(1);
  await expect(panel.getByRole('link', { name: /popular all pick/ })).toBeVisible();
  expect(popularRequests).toBe(2);
  await panel.getByRole('button', { name: 'Last year' }).click();
  await expect.poll(() => Boolean(finishYear)).toBe(true);
  await panel.getByRole('button', { name: 'Last month' }).click();
  await expect(panel.getByRole('link', { name: /popular month pick/ })).toBeVisible();
  finishYear();
  await expect(panel.getByRole('link', { name: /popular year pick/ })).toHaveCount(0);
  await expect(panel.getByText('September 2026 releases')).toBeVisible();
  await page
    .locator('.discovery-section')
    .screenshot({ path: testInfo.outputPath('discovery-popular.png') });
  await trending.getByRole('button', { name: 'Trending', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(trending.getByRole('button', { name: 'Trending', exact: true })).toHaveAttribute(
    'aria-expanded',
    'true',
  );
  panel = trending;
  await expect(panel.getByText('12 viewers this week')).toBeVisible();
  await expect(panel.getByRole('link', { name: /trending week pick/ })).toHaveAttribute(
    'href',
    '/title/mal-anime-21',
  );
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await released.getByRole('button', { name: 'Just released', exact: true }).click();
  panel = released;
  await expect(panel.getByRole('button', { name: 'English dub', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(panel.getByRole('link', { name: /dub episode/ })).toHaveAttribute(
    'href',
    '/watch/mal-anime-21/7?language=dub',
  );
  expect(
    await panel
      .locator('.discovery-item')
      .evaluate((element) => getComputedStyle(element).animationName),
  ).toBe('none');
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
});

test('simultaneous first watch tabs share one visitor cookie', async ({
  page,
  context,
  baseURL,
}, testInfo) => {
  await context.route('**/*', (route) =>
    new URL(route.request().url()).origin === baseURL ? route.continue() : route.abort(),
  );
  const mediaId = testInfo.project.name === 'chromium' ? 'mal-anime-57334' : 'mal-anime-50265';
  const before = await (await page.request.get('/api/home/discovery?mode=trending')).json();
  const initial = before.items.find((x) => x.id === mediaId)?.viewers || 0;
  let releaseFirst;
  const gate = new Promise((resolve) => {
    releaseFirst = resolve;
  });
  const cookies = [];
  await context.route(`**/api/media/${mediaId}/view`, async (route) => {
    cookies.push((await route.request().allHeaders()).cookie || '');
    if (cookies.length === 1) await gate;
    await route.continue();
  });
  await page.goto(`/watch/${mediaId}/1`);
  await expect.poll(() => cookies.length).toBe(1);
  const second = await context.newPage();
  await second.goto(`/watch/${mediaId}/1`);
  await second.bringToFront();
  await expect
    .poll(async () => {
      const locks = await second.evaluate(() => navigator.locks.query());
      return locks.pending.some((lock) => lock.name === 'yoru-watch-view');
    })
    .toBe(true);
  expect(cookies).toHaveLength(1);
  const recorded = second.waitForResponse((response) =>
    response.url().endsWith(`/api/media/${mediaId}/view`),
  );
  releaseFirst();
  await recorded;
  expect(cookies[0]).not.toContain('yoru_viewer=');
  expect(cookies[1]).toContain('yoru_viewer=');
  const after = await (await page.request.get('/api/home/discovery?mode=trending')).json();
  expect(after.items.find((x) => x.id === mediaId).viewers).toBe(initial + 1);
  await second.close();
});

test('watch page visits populate real local trending without counting refreshes twice', async ({
  page,
  context,
  baseURL,
}, testInfo) => {
  await context.route('**/*', (route) =>
    new URL(route.request().url()).origin === baseURL ? route.continue() : route.abort(),
  );
  await page.route('**/api/home?**', (route) =>
    route.fulfill({ json: { hot: [], releases: [], state: 'ready' } }),
  );
  const mediaId = testInfo.project.name === 'chromium' ? 'mal-anime-21' : 'mal-anime-47917';
  const title = mediaId === 'mal-anime-21' ? 'One Piece' : 'BOCCHI';
  const before = await (await page.request.get('/api/home/discovery?mode=trending')).json();
  const initial = before.items.find((x) => x.id === mediaId)?.viewers || 0;
  await page.goto(`/watch/${mediaId}/1`);
  await expect
    .poll(async () => {
      const response = await (await page.request.get('/api/home/discovery?mode=trending')).json();
      return response.items.find((x) => x.id === mediaId)?.viewers || 0;
    })
    .toBe(initial + 1);
  const recorded = page.waitForResponse(
    (response) =>
      response.url().endsWith(`/api/media/${mediaId}/view`) &&
      response.request().method() === 'POST',
  );
  await page.reload();
  await recorded;
  const after = await (await page.request.get('/api/home/discovery?mode=trending')).json();
  expect(after.items.find((x) => x.id === mediaId).viewers).toBe(initial + 1);
  await page.goto('/');
  await page
    .getByRole('region', { name: 'Trending', exact: true })
    .getByRole('button', { name: 'Trending', exact: true })
    .click();
  await expect(
    page
      .getByRole('region', { name: 'Trending', exact: true })
      .getByRole('link', { name: new RegExp(title) }),
  ).toBeVisible();
});
