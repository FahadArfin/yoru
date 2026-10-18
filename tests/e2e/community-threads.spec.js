import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
test.beforeEach(async ({ context, baseURL }) => {
  await context.route('**/*', (route) =>
    new URL(route.request().url()).origin === baseURL ? route.continue() : route.abort(),
  );
});
test('automatic cards open shared discussion routes and category filters preserve episode/chapter links', async ({
  page,
}, testInfo) => {
  await page.route('**/api/community/threads?*', (route) => {
    const anime = new URL(route.request().url()).searchParams.get('category') === 'anime';
    const media = {
      id: anime ? 'mal-anime-52991' : 'mal-manga-121496',
      title: anime ? 'Frieren' : 'Solo Leveling',
      category: anime ? 'ANIME' : 'MANHWA',
      cover: '/icon.svg',
    };
    return route.fulfill({
      json: {
        releaseState: 'ready',
        items: [
          {
            id: `${media.id}:4`,
            mediaId: media.id,
            media,
            unit: 4,
            comments: 0,
            releasedAt: new Date().toISOString(),
          },
        ],
      },
    });
  });
  await page.goto('/community');
  const section = page.getByRole('region', { name: 'Episode and chapter threads' });
  await expect(section.getByText('Be the first to join')).toBeVisible();
  await expect(section.getByRole('link', { name: 'Watch', exact: true })).toHaveAttribute(
    'href',
    '/watch/mal-anime-52991/4',
  );
  await section.getByRole('link', { name: 'Frieren', exact: true }).click();
  await expect(page).toHaveURL(/\/community\/mal-anime-52991\/4$/);
  await expect(page.getByRole('link', { name: 'Watch episode 4' })).toHaveAttribute(
    'href',
    '/watch/mal-anime-52991/4',
  );
  await expect(page.getByText('Sign in to join the discussion')).toBeVisible();
  await page.getByRole('link', { name: 'All discussions' }).click();
  await section.getByRole('button', { name: 'Manhwa', exact: true }).click();
  await expect(section.getByRole('link', { name: 'Read', exact: true })).toHaveAttribute(
    'href',
    '/read/mal-manga-121496/4',
  );
  await expect(section.getByText('Chapter 4')).toBeVisible();
  await section.getByLabel('Search discussion threads').fill('missing title');
  await expect(section.getByText('No matching discussions. Try another title.')).toBeVisible();
  await section.getByLabel('Search discussion threads').fill('');
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  await page.screenshot({ path: testInfo.outputPath('community-threads.png'), fullPage: true });
});
test('comments and replies are shared between Community and the original episode discussion', async ({
  page,
  baseURL,
}) => {
  const name = `Thread ${randomUUID().slice(0, 8)}`;
  const registered = await page.request.post('/api/auth/register', {
    headers: { Origin: baseURL },
    data: { name, email: `${randomUUID()}@example.test`, password: 'Yoru thread test 2026' },
  });
  expect(registered.status()).toBe(201);
  const unit = 1000 + Math.floor(Math.random() * 90000);
  const body = `Shared conversation ${randomUUID()}`;
  await page.goto(`/community/mal-anime-52991/${unit}`);
  await page.getByLabel('Discussion comment', { exact: true }).fill(body);
  await page.getByRole('button', { name: 'Post comment', exact: true }).click();
  await expect(page.locator('.comment-list')).toContainText(body);
  await page.goto(`/title/mal-anime-52991?unit=${unit}`);
  await expect(page.locator('.comment-list')).toContainText(body);
  await page
    .locator('.comment')
    .filter({ hasText: body })
    .getByRole('button', { name: 'Reply', exact: true })
    .click();
  await page
    .getByLabel('Discussion comment', { exact: true })
    .fill('Reply from the episode discussion');
  await page.getByRole('button', { name: 'Post reply', exact: true }).click();
  await expect(page.locator('.comment-list')).toContainText('Reply from the episode discussion');
  await page.getByRole('link', { name: 'Open this thread in Community' }).click();
  await expect(page.locator('.comment-list')).toContainText(body);
  await expect(page.locator('.comment-list')).toContainText('Reply from the episode discussion');
  await page.goto(`/community/mal-anime-52991/${unit + 1}`);
  await expect(page.getByLabel('Discussion comment', { exact: true })).toBeVisible();
  await expect(page.getByText(body, { exact: true })).toHaveCount(0);
});
