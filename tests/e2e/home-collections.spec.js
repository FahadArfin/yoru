import { test, expect } from '@playwright/test';

test('homepage collections switch, retain cached results, and open real filtered lists', async ({
  page,
  context,
  baseURL,
}, testInfo) => {
  await context.route('**/*', (route) =>
    new URL(route.request().url()).origin === baseURL ? route.continue() : route.abort(),
  );
  const requests = [];
  await page.route('**/api/catalog?**', (route) => {
    const params = new URL(route.request().url()).searchParams;
    const format = params.get('format') || params.get('category');
    requests.push(format);
    return route.fulfill({
      json: {
        items: Array.from({ length: 6 }, (_, i) => ({
          id: `mal-${params.get('category') === 'ANIME' ? 'anime' : 'manga'}-${99000 + i}`,
          title: `${format} favorite ${i + 1}`,
          category: params.get('category'),
          type: params.get('category'),
          format: params.get('format') || params.get('category'),
          cover: '/icon.svg',
          score: 9 - i / 10,
          year: 2020,
          genres: [],
        })),
        total: 6,
      },
    });
  });
  await page.goto('/?category=anime');
  const section = page.getByRole('region', { name: 'Explore anime', exact: true });
  await section.scrollIntoViewIfNeeded();
  await expect(section.getByRole('heading', { name: 'Find your next favorite' })).toBeVisible();
  await expect(section.locator('.poster-card')).toHaveCount(6);
  await expect(
    section.getByRole('link', { name: 'View ANIME favorite 1', exact: true }),
  ).toBeVisible();
  await section.getByRole('tab', { name: /Movie night/ }).click();
  await expect(
    section.getByRole('link', { name: 'View movie favorite 1', exact: true }),
  ).toBeVisible();
  await expect(section.getByRole('link', { name: 'View full list' })).toHaveAttribute(
    'href',
    '/browse/anime?sort=score&format=movie',
  );
  await section.getByRole('tab', { name: /Movie night/ }).press('End');
  await expect(section.getByRole('tab', { name: /One-shot stories/ })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(
    section.getByRole('link', { name: 'View oneshot favorite 1', exact: true }),
  ).toBeVisible();
  await section.getByRole('tab', { name: /Movie night/ }).click();
  await expect(
    section.getByRole('link', { name: 'View movie favorite 1', exact: true }),
  ).toBeVisible();
  expect(requests.filter((value) => value === 'movie')).toHaveLength(1);
  await section.getByRole('tab', { name: /One-shot stories/ }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  await section.screenshot({ path: testInfo.outputPath('home-collections.png') });
  await section.getByRole('link', { name: 'View full list' }).click();
  await expect(page).toHaveURL(/\/browse\/manga\?sort=score&format=oneshot/);
  await expect(page.getByRole('combobox', { name: 'Manga format' })).toHaveValue('oneshot');
  await expect(page.getByRole('combobox', { name: 'Sort titles' })).toHaveValue('score');
  await expect(
    page.getByRole('link', { name: 'View oneshot favorite 1', exact: true }),
  ).toBeVisible();
});

test('saved rankings and provider failures are explained without inventing ranks', async ({
  page,
}) => {
  let failed = true;
  await page.route('**/api/catalog?**', (route) =>
    route.fulfill({
      json: {
        items: failed
          ? []
          : [
              {
                id: 'mal-anime-1',
                title: 'Saved favorite',
                category: 'ANIME',
                cover: '/icon.svg',
                genres: [],
              },
            ],
        providerUnavailable: true,
      },
    }),
  );
  await page.goto('/?category=anime');
  const section = page.getByRole('region', { name: 'Explore anime', exact: true });
  await section.scrollIntoViewIfNeeded();
  await expect(section.getByRole('status')).toContainText('temporarily unavailable');
  failed = false;
  await section.getByRole('button', { name: 'Try again' }).click();
  await expect(
    section.getByRole('link', { name: 'View Saved favorite', exact: true }),
  ).toBeVisible();
  await expect(section.locator('.poster-rank')).toHaveCount(0);
  await expect(
    section.getByText('Saved picks · live rankings are temporarily unavailable.'),
  ).toBeVisible();
  await section.getByRole('link', { name: 'Talk recommendations' }).click();
  await expect(page).toHaveURL(/\/community\?board=recommendations/);
});
