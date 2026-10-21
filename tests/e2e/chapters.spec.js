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
test('chapter message icons open isolated discussions with replies and votes', async ({
  page,
  context,
  baseURL,
}) => {
  await setup(page, context, baseURL);
  const account = await context.request.post('/api/auth/register', {
    headers: { Origin: baseURL },
    data: {
      name: 'Chapter discussion reader',
      email: `chapter-chat-${Date.now()}-${test.info().project.name}@example.com`,
      password: 'Reader-password-123',
    },
  });
  expect(account.ok()).toBeTruthy();
  await page.goto('/title/mal-manga-121496');
  const link = page.getByRole('link', { name: 'Chapter 2 discussion', exact: true });
  await expect(link).toHaveAttribute('title', 'Chapter 2 discussion');
  await link.click();
  await expect(page).toHaveURL(/unit=2#chapter-discussion$/);
  const thread = page.getByRole('region', { name: 'Chapter 2 discussion', exact: true });
  await expect(thread).toBeVisible();
  const body = `Only chapter two ${Date.now()} ${test.info().project.name}`;
  await thread.getByLabel('Discussion comment').fill(body);
  await thread.getByRole('button', { name: 'Post comment', exact: true }).click();
  const comment = thread.locator('article.comment').filter({ hasText: body });
  await expect(comment).toBeVisible();
  await comment
    .getByRole('button', { name: 'Like comment by Chapter discussion reader', exact: true })
    .click();
  await expect(
    comment.getByRole('button', { name: 'Like comment by Chapter discussion reader', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
  await comment.getByRole('button', { name: 'Dislike comment', exact: true }).click();
  await expect(
    comment.getByRole('button', { name: 'Dislike comment', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
  await comment.getByRole('button', { name: 'Reply', exact: true }).click();
  await thread.getByLabel('Discussion comment').fill('A reply about chapter two');
  await thread.getByRole('button', { name: 'Post reply', exact: true }).click();
  await expect(comment.locator('.comment-reply')).toContainText('A reply about chapter two');
  await page.getByRole('link', { name: 'Back to chapters', exact: true }).click();
  await page.getByRole('link', { name: 'Chapter 1 discussion', exact: true }).click();
  await expect(
    page.getByRole('region', { name: 'Chapter 1 discussion', exact: true }),
  ).toBeVisible();
  await expect(page.getByText(body, { exact: true })).toHaveCount(0);
  await page.getByRole('link', { name: 'Back to chapters', exact: true }).click();
  await page.getByRole('link', { name: 'Chapter 2 discussion', exact: true }).click();
  await page.reload();
  await expect(page.getByText(body, { exact: true })).toBeVisible();
  await expect(comment.locator('.comment-reply')).toContainText('A reply about chapter two');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
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
    await expect(list.getByLabel('Translation language')).toHaveValue('en');
    await expect(list.getByText('2 of 2 editions')).toBeVisible();
    expect(requests[0].get('language')).toBe('en');
    await expect(list.locator('.live-chapter-link')).toHaveCount(2);
    await expect(list.getByRole('link', { name: /The little interlude/ })).toHaveCount(0);
    await list.getByLabel('Translation language').selectOption('all');
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
    await expect(list.getByLabel('Translation language')).toHaveValue('en');
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
    await page.getByRole('tab', { name: 'Reviews', exact: true }).click();
    await page.getByRole('tab', { name: 'Chapters', exact: true }).click();
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
  await page.route(/\/api\/media\/[^/]+\/chapters\/[^/]+\/rating(?:\?|$)/, async (route) => {
    const params = new URL(route.request().url()).searchParams;
    expect(params.get('destination')).toBe('yoru');
    expect(params.get('selectionFingerprint')).toBeTruthy();
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
  await page.route('**/api/media/*/chapters?*', (route) => {
    const language = new URL(route.request().url()).searchParams.get('language');
    const items = language === 'en' ? [] : [editions[1]];
    return route.fulfill({
      json: {
        state: 'ready',
        source: 'MangaDex',
        languages: ['es-la'],
        items,
        total: items.length,
        nextOffset: null,
      },
    });
  });
  await region.getByRole('button', { name: /Try again/i }).click();
  await expect(region.getByLabel('Translation language')).toHaveValue('en');
  await expect(
    region.getByRole('heading', { name: 'No English chapters available' }),
  ).toBeVisible();
  await region.getByRole('button', { name: 'Show all translations' }).click();
  await expect(region.getByLabel('Translation language')).toHaveValue('all');
  await expect(region.getByRole('link', { name: /The little interlude/ })).toBeVisible();
});

test('compact manga directory groups translations and volumes with working collapse, index and sorting', async ({
  page,
  context,
  baseURL,
}) => {
  await setup(page, context, baseURL);
  await page.route('**/api/media/*/chapters?*', (route) => {
    const items = [
      { ...editions[0], volume: null, number: '14' },
      { ...editions[1], volume: null, number: '14' },
      { ...editions[2], volume: '2', number: '1.5' },
      { ...editions[2], id: 'special', volume: '2', number: null, title: 'Bonus chapter' },
      { ...editions[0], id: 'opening', volume: '1', number: '1', title: 'Opening' },
    ];
    return route.fulfill({
      json: {
        state: 'ready',
        mangaId: 'test',
        languages: ['en', 'es-la'],
        items,
        total: items.length,
        nextOffset: null,
      },
    });
  });
  await page.goto('/title/mal-manga-21');
  await page.getByLabel('Translation language').selectOption('all');
  await expect(page.getByRole('tab', { name: 'Chapters', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  const volumes = page.locator('.chapter-volume');
  await expect(volumes).toHaveCount(3);
  await expect(volumes.locator(':scope > summary > strong')).toHaveText([
    'No volume',
    'Volume 2',
    'Volume 1',
  ]);
  const translations = page.locator('.chapter-translation-group');
  await expect(translations.locator('.live-chapter-row')).toHaveCount(2);
  await translations.locator('summary').click();
  await expect(translations.getByRole('link').first()).toBeHidden();
  await translations.locator('summary').click();
  await expect(translations.getByRole('link').first()).toBeVisible();
  await volumes.nth(1).locator(':scope > summary').click();
  await expect(volumes.nth(1).getByText('Bonus chapter', { exact: false })).toBeHidden();
  await page.getByRole('button', { name: 'Index', exact: true }).click();
  await page
    .getByRole('navigation', { name: 'Volume index' })
    .getByRole('button', { name: 'Volume 2', exact: true })
    .click();
  await expect(volumes.nth(1).getByText('Bonus chapter', { exact: false })).toBeVisible();
  await expect(volumes.nth(1).locator(':scope > summary')).toBeFocused();
  await page.getByRole('button', { name: 'Show oldest chapters first' }).click();
  await expect(volumes.locator(':scope > summary > strong')).toHaveText([
    'No volume',
    'Volume 1',
    'Volume 2',
  ]);
  await page.getByRole('button', { name: 'Add to library', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Sign in to Yoru', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
test('short synopses can expand whenever the phone layout clips them', async ({
  page,
  context,
  baseURL,
}) => {
  await setup(page, context, baseURL);
  const response = await context.request.get('/api/media/mal-manga-21');
  const payload = await response.json();
  const media = payload.media || payload;
  const description =
    'A curious traveler discovers a quiet village hidden beyond the mountains. Every night its residents gather to share stories of the stars, until a mysterious visitor arrives with a map that could change their lives forever. Together, they must uncover the truth before the last light disappears.';
  expect(description.length).toBeLessThan(450);
  await page.route('**/api/media/mal-manga-21', (route) =>
    route.fulfill({ json: { media: { ...media, description } } }),
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/title/mal-manga-21');
  const synopsis = page.getByRole('region', { name: 'Synopsis' });
  await synopsis.getByRole('button', { name: 'Read more' }).click();
  await expect(synopsis.locator('p')).not.toHaveClass('collapsed-story');
  await synopsis.getByRole('button', { name: 'Show less' }).click();
  await expect(synopsis.getByRole('button', { name: 'Read more' })).toBeVisible();
  await expect(page.locator('.chapter-edition-date time').first()).toBeVisible();
  await page.setViewportSize({ width: 1800, height: 1000 });
  await expect(synopsis.getByRole('button', { name: 'Read more' })).toBeHidden();
});

test('anime episode tabs also preserve selection when coming from reviews', async ({
  page,
  context,
  baseURL,
}) => {
  await setup(page, context, baseURL);
  await page.goto('/title/mal-anime-52991?tab=reviews');
  await page.getByRole('tab', { name: 'Episodes', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Episode guide' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('tab', { name: 'Episodes', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await page.getByRole('tab', { name: 'Overview', exact: true }).click();
  await page.reload();
  await expect(page.getByRole('tab', { name: 'Overview', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
});
