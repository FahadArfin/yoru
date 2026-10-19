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
        items: Array.from({ length: mode === 'trending' ? 12 : 8 }, (_, i) => ({
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

test('homepage trending shows the top ten ranked titles for each category', async ({
  page,
  context,
  baseURL,
}) => {
  await mockFeeds(page, context, baseURL);
  for (const category of ['anime', 'manga', 'manhwa']) {
    await page.goto(`/?category=${category}`);
    const trending = page.getByRole('region', { name: 'Trending', exact: true });
    await trending.getByRole('button', { name: 'Trending', exact: true }).click();
    await expect(trending.locator('.release-grid .discovery-item')).toHaveCount(10);
    const prefix = category === 'anime' ? 'home' : category;
    await expect(
      trending.getByRole('link', { name: new RegExp(`${prefix} trending week 10\\b`) }),
    ).toBeVisible();
    await expect(
      trending.getByRole('link', { name: new RegExp(`${prefix} trending week 11\\b`) }),
    ).toHaveCount(0);
  }
});

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
    expect(
      Math.abs(switchBounds.x + switchBounds.width / 2 - (banner.x + banner.width / 2)),
    ).toBeLessThan(2);
    await expect(page.getByText('MAKE YOURSELF AT HOME', { exact: true })).toHaveCount(0);
    await expect(page.locator('.home-category-intro')).toHaveCount(0);
  };
  await checkBannerSwitch();
  await expect(toggle.getByRole('tab', { name: 'Anime', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await page.locator('.weekly-hero').hover();
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
  await expect(popular.getByRole('button', { name: 'Last month', exact: true })).toBeVisible();
  await expect(popular.getByRole('link', { name: /manga popular month 1/ })).toBeVisible();
  const trending = page.getByRole('region', { name: 'Trending', exact: true });
  await trending.getByRole('button', { name: 'Trending', exact: true }).click();
  await expect(trending.getByText('7 readers this week').first()).toBeVisible();
  await expect(trending.locator('.release-grid .discovery-item')).toHaveCount(10);
  await expect(trending.getByRole('link', { name: /manga trending week 10\b/ })).toBeVisible();
  await expect(trending.getByRole('link', { name: /manga trending week 11\b/ })).toHaveCount(0);
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
  const explorer = page.getByRole('region', { name: 'Explore manhwa', exact: true });
  await expect(explorer.getByRole('heading', { name: 'More stories' })).toBeVisible();
  await expect(explorer.getByRole('link', { name: /Fantasy/ })).toHaveAttribute(
    'href',
    '/browse/manhwa?genre=Fantasy',
  );
  await expect(page.getByRole('region', { name: 'Manhwa community', exact: true })).toHaveCount(0);
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
  await page.locator('.weekly-hero').hover();
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
  const registered = await context.request.post('/api/auth/register', {
    headers: { Origin: baseURL },
    data: {
      name: 'Test reader',
      email: `resume-${Date.now()}-${Math.random()}@example.test`,
      password: 'Reader fixture password 2026',
    },
  });
  expect(registered.status()).toBe(201);
  await page.route(/\/api\/library(?:\?|$)/, (route) =>
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
  await page.route(/\/api\/resume(?:\?|$)/, (route) =>
    route.fulfill({
      json: {
        items: [
          {
            mediaId: 'mal-manga-2',
            category: 'MANGA',
            title: 'Saved manga',
            cover: '/icon.svg',
            number: 7,
            chapterId: 'saved-chapter-2',
            page: 9,
            updatedAt: Date.now(),
          },
          {
            mediaId: 'mal-manga-3',
            category: 'MANHWA',
            title: 'Saved manhwa',
            cover: '/icon.svg',
            number: 7,
            chapterId: 'saved-chapter-3',
            page: 9,
            updatedAt: Date.now(),
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
    await page.locator('.weekly-hero').hover();
    await toggle.getByRole('tab', { name: label, exact: true }).click();
    await expect(
      page.getByRole('region', {
        name: category === 'anime' ? 'Hot this week' : `Featured ${category}`,
        exact: true,
      }),
    ).toBeVisible();
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

test('banner controls sit at bottom center, reveal on hover or keyboard, and stay available on touch', async ({
  page,
  context,
  baseURL,
  isMobile,
}, testInfo) => {
  await mockFeeds(page, context, baseURL);
  await page.goto('/?category=manga');
  const hero = page.locator('.weekly-hero');
  const tabs = page.getByRole('tablist', { name: 'Homepage category' });
  const bar = page.locator('.home-category-bar');
  const controls = hero.locator('.weekly-controls');
  await expect(controls).toBeAttached();
  const frame = await hero.boundingBox();
  const bounds = await bar.boundingBox();
  expect(Math.abs(bounds.x + bounds.width / 2 - (frame.x + frame.width / 2))).toBeLessThan(2);
  expect(frame.y + frame.height - bounds.y - bounds.height).toBeLessThan(30);
  const actions = await hero.locator('.weekly-actions').boundingBox();
  expect(actions.y + actions.height).toBeLessThan(bounds.y);
  if (!isMobile) {
    await page.mouse.move(10, frame.y + frame.height + 25);
    await expect(bar).toHaveCSS('opacity', '0');
    await expect(controls).toHaveCSS('opacity', '0');
    await hero.hover({ position: { x: frame.width - 20, y: frame.height - 20 } });
    await expect(bar).toHaveCSS('opacity', '1');
    await expect(controls).toHaveCSS('opacity', '1');
    await tabs.getByRole('tab', { name: 'Manga', exact: true }).click();
    await page.mouse.move(10, frame.y + frame.height + 25);
    await expect(bar).toHaveCSS('opacity', '0');
    await expect(controls).toHaveCSS('opacity', '0');
    await page.keyboard.press('Tab');
    await expect(bar).toHaveCSS('opacity', '1');
    await tabs.getByRole('tab', { name: 'Manga', exact: true }).focus();
    await page.keyboard.press('ArrowRight');
    await expect(tabs.getByRole('tab', { name: 'Manhwa', exact: true })).toBeFocused();
    await expect(bar).toHaveCSS('opacity', '1');
  } else {
    await expect(bar).toHaveCSS('opacity', '1');
    await expect(controls).toHaveCSS('opacity', '1');
    await tabs.getByRole('tab', { name: 'Manhwa', exact: true }).click();
  }
  await expect(tabs.getByRole('tab', { name: 'Manhwa', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await page.screenshot({ path: testInfo.outputPath('banner-controls.png') });
  await tabs.getByRole('tab', { name: 'Anime', exact: true }).click();
  await expect(page.getByText('Popular anime airing this week')).toHaveCount(0);
});
