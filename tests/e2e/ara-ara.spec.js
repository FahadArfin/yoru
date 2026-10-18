import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
test.beforeEach(async ({ context, baseURL }) => {
  await context.route('**/*', (route) =>
    new URL(route.request().url()).origin === baseURL ? route.continue() : route.abort(),
  );
});
test('shared homepage, discovery, search and title pages stay inside the collection', async ({
  page,
}, testInfo) => {
  await page.goto('/ara-ara?category=manhwa');
  await page.getByRole('button', { name: 'I’m 18 or older' }).click();
  await expect(page.getByRole('region', { name: 'Featured manhwa' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'New series', exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Most popular', exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Trending', exact: true })).toBeVisible();
  await page
    .getByRole('navigation', { name: 'Explore Ara Ara' })
    .getByRole('link', { name: 'Manhwa', exact: true })
    .click();
  await expect(page.locator('.compact-category-page')).toBeVisible();
  await expect(page.getByRole('tab', { name: 'New series', exact: true })).toBeVisible();
  await page.getByRole('tab', { name: 'New series', exact: true }).click();
  const cards = page.locator('.discovery-section .release-card');
  await expect(cards).toHaveCount(4);
  for (const href of await cards.evaluateAll((els) => els.map((x) => x.getAttribute('href'))))
    expect(href).toMatch(/^\/ara-ara\/title\//);
  const search = page.getByRole('combobox', { name: 'Search anime, manga, and manhwa' });
  await search.fill('death');
  const results = page.getByRole('listbox');
  await expect(results).toContainText('Death Note');
  await results.getByRole('option').first().click();
  await expect(page).toHaveURL(/ara-ara\/title\/mal-manga-21$/);
  await expect(page.getByRole('heading', { name: 'Death Note', exact: true })).toBeVisible();
  await page.getByRole('tab', { name: 'Reviews', exact: true }).click();
  await expect(page).toHaveURL(/tab=reviews/);
  await page.goto('/ara-ara/manga?view=all&q=death');
  await expect(page.locator('.browse-grid .poster-card')).toHaveCount(1);
  await page.getByRole('textbox', { name: 'Search catalog' }).fill('one piece');
  await page
    .getByRole('region', { name: 'Catalog filters' })
    .getByRole('button', { name: 'Search', exact: true })
    .click();
  await expect(page.locator('.browse-grid .poster-card')).toHaveCount(0);
  await expect(
    page.getByRole('heading', { name: 'No plot twists here. Just no results.' }),
  ).toBeVisible();
  await page.goto('/ara-ara/title/mal-anime-52991');
  await expect(page.getByRole('heading', { name: 'Title not in this collection' })).toBeVisible();
  await page.goto('/ara-ara/manhwa');
  await expect(page.getByRole('tab', { name: 'New series', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  await page.screenshot({ path: testInfo.outputPath('ara-parity.png') });
});
test('My Space shares episode discussions while filtering titles and library', async ({
  page,
  baseURL,
}) => {
  const suffix = randomUUID();
  const registered = await page.request.post('/api/auth/register', {
    headers: { Origin: baseURL },
    data: {
      name: 'Ara ' + suffix.slice(0, 8),
      email: suffix + '@example.test',
      password: 'Ara test password 2026',
    },
  });
  expect(registered.status()).toBe(201);
  for (const [id, body] of [
    ['mal-manga-21', 'Inside ' + suffix],
    ['mal-anime-52991', 'Outside ' + suffix],
  ]) {
    expect(
      (
        await page.request.post('/api/comments/' + id, {
          headers: { Origin: baseURL },
          data: { body, unit: 1 },
        })
      ).ok(),
    ).toBe(true);
  }
  await page.goto('/ara-ara/community');
  await page.getByRole('button', { name: 'I’m 18 or older' }).click();
  await expect(page.getByRole('heading', { name: 'My Space', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Latest activity', exact: true }).click();
  await expect(page.getByText('Inside ' + suffix, { exact: true })).toBeVisible();
  await expect(page.getByText('Outside ' + suffix, { exact: true })).toHaveCount(0);
  await page
    .locator('.feed-card')
    .filter({ hasText: 'Inside ' + suffix })
    .getByRole('link')
    .first()
    .click();
  await expect(page).toHaveURL(/ara-ara\/community\/mal-manga-21\/1$/);
  await page.getByLabel('Discussion comment', { exact: true }).fill('Reply ' + suffix);
  await page.getByRole('button', { name: 'Post comment', exact: true }).click();
  await expect(page.getByText('Reply ' + suffix, { exact: true })).toBeVisible();
  const comments = await (await page.request.get('/api/comments/mal-manga-21?unit=1')).json();
  expect(JSON.stringify(comments)).toContain('Reply ' + suffix);
  await page
    .getByRole('navigation', { name: 'My Space sections' })
    .getByRole('link', { name: 'Library', exact: true })
    .click();
  await expect(page).toHaveURL(/ara-ara\/library$/);
  await page
    .getByRole('navigation', { name: 'My Space sections' })
    .getByRole('link', { name: 'Rooms', exact: true })
    .click();
  await expect(page).toHaveURL(/ara-ara\/rooms$/);
});
test('shared schedule uses collection-scoped requests and preserves chapter paging', async ({
  page,
}) => {
  await page.route('**/api/chapter-calendar?**', async (route) => {
    const p = new URL(route.request().url()).searchParams;
    expect(p.get('collection')).toBe('ara-ara');
    const offset = Number(p.get('offset'));
    const category = p.get('category');
    await route.fulfill({
      json: {
        state: 'ready',
        nextOffset: offset ? null : 100,
        items: [
          {
            id: category + '-' + offset,
            mediaId: 'mal-manga-21',
            title: category + ' page ' + (offset ? 2 : 1),
            chapter: offset ? '2' : '1',
            publishedAt: p.get('date') + 'T12:00:00Z',
            language: 'en',
          },
        ],
      },
    });
  });
  await page.goto('/ara-ara/schedule?category=manga');
  await page.getByRole('button', { name: 'I’m 18 or older' }).click();
  await expect(page.getByText('manga page 1', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Load more chapters' }).click();
  await expect(page.getByText('manga page 2', { exact: true })).toBeVisible();
  await page
    .getByRole('group', { name: 'Schedule category' })
    .getByRole('button', { name: 'Manhwa', exact: true })
    .click();
  await expect(page.getByText('manhwa page 1', { exact: true })).toBeVisible();
  await expect(page.getByText('manga page 2', { exact: true })).toHaveCount(0);
});

test('watch and reader controls keep their Ara Ara routes', async ({ page }) => {
  await page.goto('/ara-ara/watch/mal-anime-16498/1');
  await page.getByRole('button', { name: 'I’m 18 or older' }).click();
  await expect(page.locator('iframe')).toHaveCount(1);
  await expect(
    page
      .getByRole('region', { name: 'About this anime' })
      .getByRole('link', { name: 'Attack on Titan', exact: true }),
  ).toHaveAttribute('href', '/ara-ara/title/mal-anime-16498');
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(page).toHaveURL(/ara-ara\/watch\/mal-anime-16498\/2/);
  await page.goto('/ara-ara/read/mal-manga-21/1');
  await expect(page.getByRole('navigation', { name: 'Reader navigation' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Back to Death Note', exact: true })).toHaveAttribute(
    'href',
    '/ara-ara/title/mal-manga-21',
  );
  await page.getByRole('link', { name: 'Back to Death Note', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Death Note', exact: true })).toBeVisible();
});
