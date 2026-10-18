import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';

test.beforeEach(async ({ context, baseURL }) => {
  await context.route('**/*', (route) =>
    new URL(route.request().url()).origin === baseURL ||
    (process.env.YORU_QA_SCREENSHOTS && route.request().resourceType() === 'image')
      ? route.continue()
      : route.abort(),
  );
});

test('curated browsing, title actions and gated deep links work across formats', async ({
  page,
}, testInfo) => {
  await page.goto('/ara-ara/title/mal-manga-21');
  await expect(page.getByRole('heading', { name: 'Adults only', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Death Note', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'I’m 18 or older' }).click();
  await expect(page.getByRole('heading', { name: 'Death Note', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Read in Yoru', exact: true })).toHaveAttribute(
    'href',
    '/title/mal-manga-21',
  );
  await page.getByRole('button', { name: 'Reviews', exact: true }).click();
  await expect(page).toHaveURL(/tab=reviews/);
  await page.getByRole('link', { name: 'Ara Ara home', exact: true }).first().click();
  await expect(page.locator('.ara-poster-grid .poster-card')).toHaveCount(12);
  if (process.env.YORU_QA_SCREENSHOTS) {
    mkdirSync('.cache', { recursive: true });
    await page.locator('.ara-feature > img').evaluate((img) => img.decode().catch(() => {}));
    await page.screenshot({ path: `.cache/ara-mature-${testInfo.project.name}.png` });
  }
  await page.getByRole('searchbox', { name: 'Search Ara Ara' }).fill('death');
  await expect(page.locator('.ara-poster-grid .poster-card')).toHaveCount(1);
  await page.getByRole('searchbox', { name: 'Search Ara Ara' }).fill('one piece');
  await expect(page.getByRole('heading', { name: 'No matching stories' })).toBeVisible();
  await page.getByRole('button', { name: 'Clear filters' }).click();
  await page.getByRole('combobox', { name: 'Genre', exact: true }).selectOption('Horror');
  await expect(page.locator('.ara-poster-grid .poster-card')).not.toHaveCount(12);
  await page
    .getByRole('navigation', { name: 'Explore Ara Ara' })
    .getByRole('link', { name: 'Anime', exact: true })
    .click();
  await expect(page.locator('.ara-poster-grid .poster-card')).toHaveCount(4);
  await page.getByRole('link', { name: 'View Vinland Saga', exact: true }).click();
  await expect(page).toHaveURL(/ara-ara\/title\/mal-anime-37521$/);
  await expect(page.getByRole('link', { name: 'Watch in Yoru', exact: true })).toHaveAttribute(
    'href',
    '/watch/mal-anime-37521/1',
  );
  await page.goto('/ara-ara/title/mal-anime-21');
  await expect(page.getByRole('heading', { name: 'Title not in this collection' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
});

test('chapter schedule can page releases and resets on date and format changes', async ({
  page,
}) => {
  await page.route('**/api/chapter-calendar?**', async (route) => {
    const params = new URL(route.request().url()).searchParams;
    const offset = Number(params.get('offset'));
    const category = params.get('category');
    await route.fulfill({
      json: {
        state: 'ready',
        nextOffset: offset ? null : 100,
        items: [
          {
            id: `${category}-${offset}`,
            mediaId: 'mal-manga-21',
            title: `${category} page ${offset ? 2 : 1}`,
            chapter: offset ? '2' : '1',
            publishedAt: `${params.get('date')}T12:00:00Z`,
          },
        ],
      },
    });
  });
  await page.goto('/ara-ara/schedule?format=manga');
  await page.getByRole('button', { name: 'I’m 18 or older' }).click();
  await expect(page.getByText('manga page 1', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Check more releases' }).click();
  await expect(page.getByText('manga page 2', { exact: true })).toBeVisible();
  await expect(page.getByText('manga page 1', { exact: true })).toBeVisible();
  await page
    .getByRole('group', { name: 'Schedule format' })
    .getByRole('button', { name: 'manhwa', exact: true })
    .click();
  await expect(page.getByText('manhwa page 1', { exact: true })).toBeVisible();
  await expect(page.getByText('manga page 2', { exact: true })).toHaveCount(0);
  await page.goBack();
  await expect(page.getByText('manga page 1', { exact: true })).toBeVisible();
  await expect(page.getByText('manga page 2', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Check more releases' }).click();
  const days = page.getByRole('group', { name: 'Schedule day' });
  await days.locator('button[aria-pressed="false"]').first().click();
  await expect(page.getByText('manga page 1', { exact: true })).toBeVisible();
  await expect(page.getByText('manga page 2', { exact: true })).toHaveCount(0);
});

test('community uses real scoped discussions and schedule preserves the selected format', async ({
  page,
  baseURL,
}) => {
  const suffix = randomUUID();
  const registered = await page.request.post('/api/auth/register', {
    headers: { Origin: baseURL },
    data: {
      name: `Ara ${suffix.slice(0, 8)}`,
      email: `${suffix}@example.test`,
      password: 'Ara test password 2026',
    },
  });
  expect(registered.status()).toBe(201);
  for (const [id, body] of [
    ['mal-manga-21', `Inside ${suffix}`],
    ['mal-anime-52991', `Outside ${suffix}`],
  ]) {
    const response = await page.request.post(`/api/comments/${id}`, {
      headers: { Origin: baseURL },
      data: { body, unit: 0 },
    });
    expect(response.ok()).toBe(true);
  }
  const feed = await (await page.request.get('/api/community?collection=ara-ara')).json();
  expect(feed.items.some((item) => item.body === `Inside ${suffix}`)).toBe(true);
  expect(feed.items.some((item) => item.body === `Outside ${suffix}`)).toBe(false);
  await page.goto('/ara-ara/community');
  await page.getByRole('button', { name: 'I’m 18 or older' }).click();
  await expect(page.getByText(`Inside ${suffix}`, { exact: true })).toBeVisible();
  await expect(page.getByText(`Outside ${suffix}`, { exact: true })).toHaveCount(0);
  await page
    .locator('.ara-feed article')
    .filter({ hasText: `Inside ${suffix}` })
    .getByRole('link')
    .click();
  await expect(page.getByLabel('Discussion comment', { exact: true })).toBeVisible();
  await page.getByLabel('Discussion comment', { exact: true }).fill(`Reply from Ara ${suffix}`);
  await page.getByRole('button', { name: 'Post comment', exact: true }).click();
  await expect(page.getByText(`Reply from Ara ${suffix}`, { exact: true })).toBeVisible();
  await page
    .getByRole('navigation', { name: 'Explore Ara Ara' })
    .getByRole('link', { name: 'Schedule', exact: true })
    .click();
  await expect(page.getByRole('group', { name: 'Schedule day' }).getByRole('button')).toHaveCount(
    7,
  );
  await page
    .getByRole('group', { name: 'Schedule format' })
    .getByRole('button', { name: 'manhwa', exact: true })
    .click();
  await expect(page).toHaveURL(/format=manhwa/);
  await expect(
    page.getByRole('heading', { name: 'No confirmed releases for this day' }),
  ).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
});
