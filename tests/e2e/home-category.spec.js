import { test, expect } from '@playwright/test';

async function mockFeeds(page, context, baseURL) {
  await context.route('**/*', (route) =>
    new URL(route.request().url()).origin === baseURL ? route.continue() : route.abort(),
  );
  await page.route('**/api/home?**', (route) =>
    route.fulfill({ json: { state: 'ready', language: 'all', hot: [], releases: [] } }),
  );
  await page.route('**/api/{home,manga,manhwa}/discovery?**', (route) => {
    const url = new URL(route.request().url());
    const category = url.pathname.split('/')[2];
    const mode = url.searchParams.get('mode'),
      period = url.searchParams.get('period');
    return route.fulfill({
      json: {
        state: 'ready',
        mode,
        period,
        caption: `${category} ${period} publication dates`,
        items: Array.from({ length: 8 }, (_, i) => ({
          id: `mal-${category === 'home' ? 'anime' : 'manga'}-${i + 1}`,
          title: `${category} ${mode} ${period} ${i + 1}`,
          category: category === 'home' ? 'ANIME' : category.toUpperCase(),
          cover: '/icon.svg',
          year: 2026,
          startDate: '2026-09-01',
          status: 'Finished',
          viewers: 7,
        })),
      },
    });
  });
}

test('homepage switches complete categories, retains links, filters and saved preference', async ({
  page,
  context,
  baseURL,
}, testInfo) => {
  await mockFeeds(page, context, baseURL);
  await page.goto('/');
  const toggle = page.getByRole('tablist', { name: 'Homepage category' });
  const checkBannerSwitch = async () => {
    const switchBounds = await toggle.boundingBox();
    const banner = await page.locator('.weekly-hero').boundingBox();
    const header = await page.locator('.topbar').boundingBox();
    expect(switchBounds.y).toBeGreaterThanOrEqual(header.y + header.height);
    expect(switchBounds.y).toBeGreaterThanOrEqual(banner.y);
    expect(switchBounds.y + switchBounds.height).toBeLessThan(banner.y + banner.height);
    expect(banner.x + banner.width - switchBounds.x - switchBounds.width).toBeLessThan(60);
    await expect(page.getByText('MAKE YOURSELF AT HOME', { exact: true })).toHaveCount(0);
    await expect(page.locator('.home-category-intro')).toHaveCount(0);
  };
  await checkBannerSwitch();
  await expect(toggle.getByRole('tab', { name: 'Anime', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await toggle.getByRole('tab', { name: 'Manga', exact: true }).click();
  await expect(page).toHaveURL(/\?category=manga$/);
  const hero = page.getByRole('region', { name: 'Featured manga', exact: true });
  await expect(hero.getByRole('heading', { name: 'manga popular all 1' })).toBeVisible();
  await checkBannerSwitch();
  await expect(page.getByRole('region', { name: 'Hot this week', exact: true })).toHaveCount(0);
  await expect(page.getByRole('complementary', { name: 'Anime highlights' })).toHaveCount(0);
  await expect(page.getByRole('group', { name: 'Release filter' })).toHaveCount(0);
  const fresh = page.getByRole('region', { name: 'New series', exact: true });
  await expect(fresh.getByRole('link', { name: /manga new all 1/ })).toHaveAttribute(
    'href',
    '/title/mal-manga-1',
  );
  const popular = page.getByRole('region', { name: 'Most popular', exact: true });
  await popular.getByRole('button', { name: 'Most popular', exact: true }).click();
  await popular.getByRole('button', { name: 'Last month' }).click();
  await expect(popular.getByRole('link', { name: /manga popular month 1/ })).toBeVisible();
  const trending = page.getByRole('region', { name: 'Trending', exact: true });
  await trending.getByRole('button', { name: 'Trending', exact: true }).click();
  await expect(trending.getByText('7 readers this week').first()).toBeVisible();
  await toggle.getByRole('tab', { name: 'Manga', exact: true }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(toggle.getByRole('tab', { name: 'Manhwa', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(
    page
      .getByRole('region', { name: 'Featured manhwa', exact: true })
      .getByRole('heading', { name: 'manhwa popular all 1' }),
  ).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Explore the manhwa collection' })).toBeVisible();
  await checkBannerSwitch();
  const highlights = await page
    .getByRole('complementary', { name: 'Manhwa highlights' })
    .boundingBox();
  const discovery = await page.locator('.discovery-panels').boundingBox();
  expect(highlights.y).toBeGreaterThan(discovery.y + discovery.height);
  await toggle.scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath('category-manhwa.png') });
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  await page.goBack();
  await expect(toggle.getByRole('tab', { name: 'Manga', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await page.goto('/');
  await expect(toggle.getByRole('tab', { name: 'Manga', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await toggle.getByRole('tab', { name: 'Anime', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Just released', exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Featured manga', exact: true })).toHaveCount(0);
});

test('explicit homepage category works with unavailable storage and invalid values are safe', async ({
  page,
  context,
  baseURL,
}) => {
  await mockFeeds(page, context, baseURL);
  await context.addInitScript(() => {
    Storage.prototype.getItem = () => {
      throw new Error('Storage blocked');
    };
    Storage.prototype.setItem = () => {
      throw new Error('Storage blocked');
    };
  });
  await page.goto('/?category=manhwa');
  await expect(
    page
      .getByRole('region', { name: 'Featured manhwa', exact: true })
      .getByRole('heading', { name: 'manhwa popular all 1' }),
  ).toBeVisible();
  await page.goto('/?category=unknown');
  await expect(
    page
      .getByRole('tablist', { name: 'Homepage category' })
      .getByRole('tab', { name: 'Anime', exact: true }),
  ).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('region', { name: 'Just released', exact: true })).toBeVisible();
});

test('homepage resumes anime, manga and manhwa together below every category banner', async ({
  page,
  context,
  baseURL,
}) => {
  await mockFeeds(page, context, baseURL);
  await page.route('**/api/auth/me', (route) =>
    route.fulfill({ json: { user: { id: 'test-reader', name: 'Test reader' } } }),
  );
  await page.route('**/api/library', (route) =>
    route.fulfill({
      json: {
        items: [
          {
            mediaId: 'mal-anime-1',
            status: 'watching',
            progress: 4,
            media: {
              id: 'mal-anime-1',
              category: 'ANIME',
              title: 'Saved anime',
              cover: '/icon.svg',
            },
          },
          {
            mediaId: 'mal-manga-2',
            status: 'reading',
            progress: 3,
            media: {
              id: 'mal-manga-2',
              category: 'MANGA',
              title: 'Saved manga',
              cover: '/icon.svg',
            },
          },
          {
            mediaId: 'mal-manga-3',
            status: 'reading',
            progress: 8,
            media: {
              id: 'mal-manga-3',
              category: 'MANHWA',
              title: 'Saved manhwa',
              cover: '/icon.svg',
            },
          },
          {
            mediaId: 'mal-manga-4',
            status: 'reading',
            progress: 5,
            media: {
              id: 'mal-manga-4',
              category: 'MANGA',
              title: 'Library only manga',
              cover: '/icon.svg',
            },
          },
        ],
      },
    }),
  );
  await context.addInitScript(() => {
    for (const [id, category, title] of [
      [2, 'MANGA', 'Saved manga'],
      [3, 'MANHWA', 'Saved manhwa'],
    ]) {
      localStorage.setItem(
        `yoru:reader:state:mal-manga-${id}`,
        JSON.stringify({
          category,
          title,
          cover: '/icon.svg',
          number: 7,
          lastChapter: `saved-chapter-${id}`,
          chapters: { [`saved-chapter-${id}`]: { page: 9 } },
          updatedAt: Date.now(),
        }),
      );
    }
  });
  await page.goto('/?category=anime');
  const toggle = page.getByRole('tablist', { name: 'Homepage category' });
  for (const [category, label, id] of [
    ['anime', 'Anime', 1],
    ['manga', 'Manga', 2],
    ['manhwa', 'Manhwa', 3],
  ]) {
    await toggle.getByRole('tab', { name: label, exact: true }).click();
    const row = page.getByRole('region', {
      name: 'Pick up where you left off',
      exact: true,
    });
    await expect(row).toHaveCount(1);
    await expect(row).toBeVisible();
    const resume = await row.boundingBox();
    const banner = await page.locator('.weekly-hero').boundingBox();
    const discovery = await page.locator('.discovery-panels').boundingBox();
    expect(resume.y).toBeGreaterThanOrEqual(banner.y + banner.height);
    expect(resume.y + resume.height).toBeLessThan(discovery.y);
    expect(resume.y).toBeLessThan(page.viewportSize().height - 100);
    const card = row.getByRole('link', { name: new RegExp(`Saved ${category}`) });
    await expect(card).toHaveCount(1);
    await expect(card).toHaveAttribute(
      'href',
      category === 'anime'
        ? '/watch/mal-anime-1/4'
        : `/read/mal-manga-${id}/7?chapter=saved-chapter-${id}&page=9`,
    );
    await expect(row.getByRole('link')).toHaveCount(4);
    await expect(row.getByRole('link', { name: /Saved anime/ })).toHaveAttribute(
      'href',
      '/watch/mal-anime-1/4',
    );
    await expect(row.getByRole('link', { name: /Saved manga/ })).toHaveAttribute(
      'href',
      '/read/mal-manga-2/7?chapter=saved-chapter-2&page=9',
    );
    await expect(row.getByRole('link', { name: /Saved manhwa/ })).toHaveAttribute(
      'href',
      '/read/mal-manga-3/7?chapter=saved-chapter-3&page=9',
    );
    await expect(row.getByRole('link', { name: /Library only manga/ })).toHaveAttribute(
      'href',
      '/read/mal-manga-4/5',
    );
  }
  for (const category of ['anime', 'manga', 'manhwa']) {
    await page.goto(`/browse/${category}`);
    await expect(page.getByRole('region', { name: 'Pick up where you left off' })).toHaveCount(0);
  }
});
