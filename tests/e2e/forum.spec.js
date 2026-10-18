import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
test.beforeEach(async ({ context, baseURL }) => {
  await context.route('**/*', (route) =>
    new URL(route.request().url()).origin === baseURL ? route.continue() : route.abort(),
  );
});
test('members create, find, reply and edit forum topics; spoilers remain concealed', async ({
  page,
  baseURL,
}, testInfo) => {
  const name = `Forum ${randomUUID().slice(0, 8)}`;
  const registered = await page.request.post('/api/auth/register', {
    headers: { Origin: baseURL },
    data: { name, email: `${randomUUID()}@example.test`, password: 'forum account 2026' },
  });
  expect(registered.status()).toBe(201);
  await page.goto('/community');
  const hub = page.getByRole('region', { name: 'Community forums' });
  await expect(
    hub.getByRole('navigation', { name: 'Forum channels' }).getByRole('button'),
  ).toHaveCount(9);
  await hub.getByRole('button', { name: /Figures & Collecting/ }).click();
  await hub.getByRole('button', { name: 'New topic', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Start a topic' });
  await expect(dialog.getByRole('combobox', { name: 'Channel', exact: true })).toHaveValue(
    'figures',
  );
  const title = `My first shelf ${randomUUID().slice(0, 8)}`;
  await dialog.getByLabel('Topic title').fill(title);
  await dialog.getByRole('combobox', { name: 'Topic type', exact: true }).selectOption('Showcase');
  await dialog.getByLabel('Your post', { exact: true }).fill('A quiet corner for my collection.');
  await dialog.getByRole('button', { name: 'Create topic', exact: true }).click();
  await expect(page).toHaveURL(/\/community\/forum\/[\w-]+$/);
  await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
  await page
    .getByLabel('Your reply', { exact: true })
    .fill('Secret detail <script>alert(1)</script>');
  await page.getByLabel('Contains spoilers').check();
  await page.getByRole('button', { name: 'Post reply', exact: true }).click();
  const replies = page.getByRole('region', { name: 'Topic replies' });
  await expect(replies.getByText('Secret detail', { exact: false })).toHaveCount(0);
  await replies.getByRole('button', { name: 'Spoiler · Reveal post' }).click();
  await expect(replies).toContainText('Secret detail <script>alert(1)</script>');
  await expect(replies.locator('script')).toHaveCount(0);
  await replies.getByRole('button', { name: 'Edit', exact: true }).click();
  await replies.getByLabel('Edit your post').fill('Updated shelf advice.');
  await replies.getByLabel('Contains spoilers').uncheck();
  await replies.getByRole('button', { name: 'Save changes' }).click();
  await expect(replies).toContainText('Updated shelf advice.');
  await page.getByLabel('Your reply', { exact: true }).fill('A draft I am still writing');
  const topicId = new URL(page.url()).pathname.split('/').pop();
  await page.request.post(`/api/forum/topics/${topicId}/replies`, {
    headers: { Origin: baseURL },
    data: { body: 'Another live reply arrives' },
  });
  await expect(replies).toContainText('Another live reply arrives');
  await expect(page.getByLabel('Your reply', { exact: true })).toHaveValue(
    'A draft I am still writing',
  );
  await page.reload();
  await expect(replies).toContainText('Updated shelf advice.');
  await page.getByRole('link', { name: 'Back to forums' }).click();
  await hub.getByLabel('Search forum topics').fill(title);
  await hub.getByRole('button', { name: 'Search', exact: true }).click();
  await expect(hub.getByRole('link', { name: title, exact: true })).toBeVisible();
  await expect(hub.locator('.forum-topic-row').filter({ hasText: title })).toContainText('2');
  await hub.getByRole('button', { name: 'All channels', exact: true }).click();
  const figuresRow = hub
    .locator('.forum-index-row')
    .filter({ has: page.getByRole('button', { name: /Figures & Collecting/ }) });
  await expect(figuresRow.locator('.forum-channel-latest a')).toBeVisible();
  await expect(figuresRow.locator('.forum-channel-counts')).toContainText('posts');
  await hub.getByRole('button', { name: /^Anime / }).click();
  await expect(hub.getByRole('link', { name: title, exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  await page.screenshot({ path: testInfo.outputPath('forums.png'), fullPage: true });
});

test('forum index uses aligned rows with real activity links at desktop and narrow phone widths', async ({
  page,
}, testInfo) => {
  if (testInfo.project.name.includes('mobile'))
    await page.setViewportSize({ width: 320, height: 740 });
  await page.route('**/api/forum/boards', (route) =>
    route.fulfill({
      json: {
        items: [
          {
            id: 'anime',
            topics: 12,
            messages: 53,
            latest: {
              id: 'example-thread',
              title:
                'A very long discussion title about this season and its surprising adaptations',
              name: 'Seasonal reader',
              createdAt: '2026-10-18T12:00:00Z',
            },
          },
          { id: 'figures', topics: 0, messages: 0, latest: null },
        ],
      },
    }),
  );
  await page.goto('/community');
  const index = page.getByRole('navigation', { name: 'Forum channels' });
  await expect(index.getByRole('button')).toHaveCount(9);
  await expect(index.getByRole('heading')).toHaveCount(3);
  const rows = index.locator('.forum-index-row');
  const anime = rows.filter({ has: page.getByRole('button', { name: /^Anime / }) });
  await expect(anime).toContainText('53 posts');
  await expect(anime.getByRole('link')).toHaveAttribute('href', '/community/forum/example-thread');
  const figures = rows.filter({ has: page.getByRole('button', { name: /Figures & Collecting/ }) });
  await expect(figures).toContainText('No posts yet');
  const bounds = await rows.evaluateAll((items) =>
    items.map((item) => {
      const rect = item.getBoundingClientRect();
      return { x: rect.x, width: rect.width, top: rect.top, bottom: rect.bottom };
    }),
  );
  for (let i = 1; i < bounds.length; i++) {
    expect(bounds[i].x).toBeCloseTo(bounds[0].x, 0);
    expect(bounds[i].width).toBeCloseTo(bounds[0].width, 0);
    expect(bounds[i].top).toBeGreaterThanOrEqual(bounds[i - 1].bottom);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  await figures.getByRole('button').press('Enter');
  await expect(index).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Discussion forums', exact: true })).toBeFocused();
  await expect(
    page.getByRole('heading', { name: 'Figures & Collecting', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'All channels', exact: true }).click();
  await expect(index).toBeVisible();
});
test('guests browse channels and can open released series discussions without duplicated chapter editions', async ({
  page,
}) => {
  await page.route('**/api/catalog?*', (route) => {
    const anime = new URL(route.request().url()).searchParams.get('category') === 'ANIME';
    return route.fulfill({
      json: {
        items: [
          {
            id: anime ? 'mal-anime-52991' : 'mal-manga-121496',
            title: anime ? 'Frieren' : 'Solo Leveling',
            category: anime ? 'ANIME' : 'MANHWA',
            status: 'Currently Airing',
            episodes: 3,
            cover: '/icon.svg',
          },
        ],
      },
    });
  });
  await page.route('**/api/media/*/episodes?*', (route) =>
    route.fulfill({
      json: {
        mediaId: 'mal-anime-52991',
        total: 3,
        latest: 2,
        items: [
          { number: 1, title: 'First', aired: '2020-01-01' },
          { number: 2, title: 'Second', aired: '2020-01-02' },
          { number: 3, title: 'Future', aired: '2099-01-01' },
        ],
        page: 1,
        pages: 1,
      },
    }),
  );
  await page.route('**/api/media/*/chapters?*', (route) =>
    route.fulfill({
      json: {
        items: [
          { number: '1', publishedAt: '2020-01-01' },
          { number: '1', publishedAt: '2020-01-02' },
          { number: '2', publishedAt: '2099-01-01' },
        ],
        nextOffset: null,
      },
    }),
  );
  await page.goto('/community');
  await page.getByRole('button', { name: 'New topic', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('button', { name: 'Close dialog' }).click();
  await page.getByRole('button', { name: 'Episode & chapter threads', exact: true }).click();
  const series = page.getByRole('region', { name: 'Browse series discussions' });
  await series.getByLabel('Find a series discussion').fill('Frieren');
  await series.getByRole('button', { name: 'Find series' }).click();
  await series.getByRole('button', { name: /Frieren/ }).click();
  await expect(series.getByRole('link', { name: /Episode 1/ })).toHaveAttribute(
    'href',
    '/community/mal-anime-52991/1',
  );
  await expect(series.getByRole('link', { name: /Episode 3/ })).toHaveCount(0);
  await expect(series).toContainText('Not released yet');
  await series.getByRole('button', { name: 'Choose another series' }).click();
  await series.getByLabel('Series category').selectOption('manhwa');
  await series.getByLabel('Find a series discussion').fill('Solo');
  await series.getByRole('button', { name: 'Find series' }).click();
  await series.getByRole('button', { name: /Solo Leveling/ }).click();
  await expect(series.getByRole('link', { name: /Chapter 1/ })).toHaveCount(1);
  await expect(series.getByRole('link', { name: /Chapter 2/ })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
});
