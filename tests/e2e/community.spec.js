import { test, expect } from '@playwright/test';

test.beforeEach(async ({ context, baseURL }) => {
  await context.route('**/*', (route) =>
    new URL(route.request().url()).origin === baseURL ? route.continue() : route.abort(),
  );
  await context.route('**/api/community/threads?*', (route) =>
    route.fulfill({ json: { items: [], releaseState: 'ready' } }),
  );
});

const media = {
  id: 'mal-anime-52991',
  title: 'Frieren: Beyond Journey’s End',
  category: 'ANIME',
  cover: '/icon.svg',
};
const entries = [
  {
    id: 'discussion',
    kind: 'comment',
    mediaId: media.id,
    media,
    unit: 4,
    author: { name: 'Hana' },
    body: 'The quiet moments are the ones that stay with you.',
    createdAt: '2026-10-17T12:00:00Z',
  },
  {
    id: 'review',
    kind: 'review',
    mediaId: media.id,
    media,
    title: 'A journey worth taking',
    author: { name: 'Ren' },
    rating: 9,
    spoiler: true,
    body: 'PRIVATE SPOILER TEXT',
    createdAt: '2026-10-17T11:00:00Z',
  },
];

test('community filters preserve discussions, review destinations and spoiler protection', async ({
  page,
}, testInfo) => {
  await page.route('**/api/community', (route) => route.fulfill({ json: { items: entries } }));
  await page.goto('/community');
  await expect(page.locator('.feed-card')).toHaveCount(2);
  await expect(page.getByText('PRIVATE SPOILER TEXT')).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Find a room' })).toHaveAttribute('href', '/rooms');
  await expect(page.getByLabel('Chat message')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  await page.screenshot({ path: testInfo.outputPath('community-populated.png'), fullPage: true });
  const filters = page.getByRole('group', { name: 'Conversation type' });
  await filters.getByRole('button', { name: 'Reviews', exact: true }).click();
  await expect(page.locator('.feed-card')).toHaveCount(1);
  await expect(filters.getByRole('button', { name: 'Reviews', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page.getByRole('link', { name: /Read review/ })).toHaveAttribute(
    'href',
    '/title/mal-anime-52991?tab=reviews',
  );
  await filters.getByRole('button', { name: 'Discussions', exact: true }).click();
  await expect(page.getByRole('link', { name: /Add your take/ })).toHaveAttribute(
    'href',
    '/community/mal-anime-52991/4',
  );
});

test('community keeps loading, failed and empty feed states distinct', async ({ page }) => {
  // Keep live snapshots from racing the deliberate failure/retry sequence.
  await page.route('**/api/config', (route) => route.fulfill({ json: { realtime: {} } }));
  let release;
  const pending = new Promise((resolve) => {
    release = resolve;
  });
  await page.route('**/api/community', async (route) => {
    await pending;
    await route.fulfill({
      status: 503,
      json: { error: 'Conversations are temporarily unavailable.' },
    });
  });
  await page.goto('/community');
  await expect(page.getByRole('status', { name: 'Loading conversations' })).toBeVisible();
  await expect(page.getByText('Every conversation starts with a story.')).toHaveCount(0);
  release();
  await expect(page.getByText('Conversations are temporarily unavailable.')).toBeVisible();
  await expect(page.getByText('Every conversation starts with a story.')).toHaveCount(0);
  await page.route('**/api/community', (route) => route.fulfill({ json: { items: [] } }));
  await page.locator('.community-feed').getByRole('button', { name: 'Try again' }).click();
  await expect(page.getByText('Every conversation starts with a story.')).toBeVisible();
  await page.getByRole('button', { name: 'Reviews', exact: true }).click();
  await expect(page.getByText('No reviews here yet.')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Find a story to talk about' })).toHaveAttribute(
    'href',
    '/browse/all',
  );
});
