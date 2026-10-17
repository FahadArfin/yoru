import { test, expect } from '@playwright/test';

const groups = [
  { id: '4f1de6a2-f0c5-4ac5-bce5-02c7dbb67deb', name: 'MangaPlus', official: true },
  { id: '889ba58d-723b-41ca-bed1-20ce9d902a28', name: 'Spanish edition', official: false },
];
const editions = [
  {
    id: '556037fd-ca2e-4d00-959e-d6320cde8b31',
    number: '2',
    title: 'Whisper, whisper',
    language: 'en',
    groups: [groups[0]],
    readUrl: 'https://mangaplus.shueisha.co.jp/viewer/1030834',
    readLabel: 'MANGA Plus',
  },
  {
    id: '8a3ba432-f940-44c6-a5a7-6a4e61a23049',
    number: '1.5',
    title: 'The little interlude',
    language: 'es-la',
    groups: [groups[1]],
    readUrl: 'https://mangadex.org/chapter/8a3ba432-f940-44c6-a5a7-6a4e61a23049',
    readLabel: 'MangaDex',
  },
  {
    id: 'b6976527-1aa9-4743-8799-72437dc0310e',
    number: '1',
    title: 'The beginning',
    language: 'en',
    groups: [groups[0]],
    readUrl: 'https://mangaplus.shueisha.co.jp/viewer/1030833',
    readLabel: 'MANGA Plus',
  },
].map((item) => ({
  ...item,
  volume: '1',
  pages: 12,
  publishedAt: '2026-10-11T15:18:11Z',
  stats: { opens: 7, rating: 4.5, votes: 2, myRating: null },
}));
async function setup(page, context, baseURL) {
  const requests = [];
  await context.route('**/*', (route) =>
    new URL(route.request().url()).origin === baseURL ? route.continue() : route.abort(),
  );
  await page.route('**/api/media/*/chapters?*', (route) => {
    const query = new URL(route.request().url()).searchParams;
    requests.push(query);
    let items = editions.filter(
      (item) =>
        (query.get('language') === 'all' || item.language === query.get('language')) &&
        (query.get('group') === 'all' || item.groups.some((g) => g.id === query.get('group'))) &&
        (!query.get('q') || item.title.includes(query.get('q'))),
    );
    if (query.get('sort') === 'asc') items = [...items].reverse();
    const total = items.length;
    const offset = Number(query.get('offset'));
    const first = offset === 0;
    return route.fulfill({
      json: {
        state: 'ready',
        source: 'MangaDex',
        mangaId: '85a12738-a597-48a6-baa1-2e4c87ab8b95',
        languages: ['en', 'es-la'],
        items: items.slice(first ? 0 : 2, first ? 2 : undefined),
        total,
        nextOffset: first && total > 2 ? 100 : null,
        offset,
      },
    });
  });
  return requests;
}
for (const [category, id] of [
  ['manga', 'mal-manga-21'],
  ['manhwa', 'mal-manga-121496'],
]) {
  test(`${category} live chapters show titles, translations, groups, activity and all pages`, async ({
    page,
    context,
    baseURL,
  }) => {
    const requests = await setup(page, context, baseURL);
    await page.goto(`/title/${id}`);
    const list = page.getByRole('region', { name: 'Live chapter catalog' });
    await expect(list.getByText('2 of 3 editions')).toBeVisible();
    await expect(list.locator('.live-chapter-row')).toHaveCount(2);
    await list.getByRole('button', { name: 'Load more editions' }).click();
    await expect(list.getByText('3 of 3 editions')).toBeVisible();
    await expect(list.locator('.live-chapter-row')).toHaveCount(3);
    await list.getByLabel('Translation language').selectOption('es-la');
    await expect(list.locator('.live-chapter-row')).toHaveCount(1);
    await expect(list.getByText('The little interlude', { exact: false })).toBeVisible();
    expect(requests.at(-1).get('language')).toBe('es-la');
    await list.getByRole('button', { name: 'Clear filters' }).click();
    await list.getByLabel('Release group').selectOption(groups[0].id);
    await expect(list.locator('.live-chapter-row')).toHaveCount(2);
    expect(requests.at(-1).get('group')).toBe(groups[0].id);
    await list.getByLabel('Search live chapters').fill('beginning');
    await list.getByRole('button', { name: 'Search', exact: true }).click();
    await expect(list.locator('.live-chapter-row')).toHaveCount(1);
    await expect(list.getByRole('link', { name: /The beginning/ })).toHaveAttribute(
      'href',
      /mangaplus.shueisha.co.jp/,
    );
    await expect(list.locator('.chapter-open-count')).toContainText('7');
    await expect(list.locator('.chapter-rating')).toContainText('4.5');
    await list.getByRole('button', { name: /Rate Chapter 1/ }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.keyboard.press('Escape');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.getByRole('tab', { name: 'Chapters', exact: true }).click();
    await expect(page).toHaveURL(/tab=chapters/);
    await page.reload();
    await expect(page.getByRole('tab', { name: 'Chapters', exact: true })).toHaveAttribute(
      'aria-selected',
      'true',
    );
  });
}
test('signed-in chapter ratings save and failed feeds have a retry without invented chapters', async ({
  page,
  context,
  baseURL,
}) => {
  await setup(page, context, baseURL);
  const account = await context.request.post('/api/auth/register', {
    headers: { Origin: baseURL },
    data: {
      name: 'Chapter reader',
      email: `chapters-${Date.now()}-${test.info().project.name}@example.com`,
      password: 'Reader-password-123',
    },
  });
  expect(account.ok()).toBeTruthy();
  await page.route('**/api/media/*/chapters/*/rating', async (route) => {
    expect(route.request().postDataJSON()).toEqual({ rating: 5 });
    await route.fulfill({ json: { opens: 7, votes: 3, rating: 4.67, myRating: 5 } });
  });
  await page.goto('/title/mal-manga-21?tab=chapters');
  await page.getByRole('button', { name: 'Rate Chapter 2 in English' }).click();
  const dialog = page.getByRole('dialog', { name: 'Rate this chapter' });
  await dialog.getByRole('button', { name: '5 stars' }).click();
  await dialog.getByRole('button', { name: 'Save rating' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.locator('.chapter-rating.rated')).toContainText('4.7');
  await page.route('**/api/media/*/chapters?*', (route) =>
    route.fulfill({
      status: 503,
      json: { error: 'MangaDex is unavailable. Please try again later.' },
    }),
  );
  await page.reload();
  const region = page.getByRole('region', { name: 'Live chapter catalog' });
  await expect(region.getByText('MangaDex is unavailable.', { exact: false })).toBeVisible();
  await expect(region.locator('.live-chapter-row')).toHaveCount(0);
  await expect(region.getByRole('button', { name: /Try again/i })).toBeVisible();
});
