import { test, expect } from '@playwright/test';
import { accountSource, accountClassification } from '../extension-account-contract.mjs';
import { navigateCollection } from './navigation';

const safe = {
  id: 'ext-manga-' + 'a'.repeat(32),
  title: 'Native catalog adventure',
  category: 'MANGA',
  sourceRef: accountSource(),
  classification: accountClassification(),
  upstreamRef: { sourceId: 'suwayomi:123', upstreamKey: '/native/adventure', language: 'en' },
  cover: 'https://private.invalid/native-cover.jpg',
  genres: ['Fantasy'],
  malId: null,
  idMal: null,
};
const adult = {
  ...safe,
  id: 'ext-manga-' + 'b'.repeat(32),
  title: 'Ara native mystery',
  isAdult: true,
  sourceRef: accountSource('456', 'mixed', 'NHentai.to'),
  classification: accountClassification('adult'),
};
const french = {
  ...safe,
  id: 'ext-manga-' + 'c'.repeat(32),
  title: 'Native French edition',
  sourceRef: { ...accountSource('789'), language: 'fr' },
  upstreamRef: { sourceId: 'suwayomi:789', upstreamKey: '/native/french', language: 'fr' },
};
const core = {
  id: 'mal-manga-21',
  title: 'Death Note',
  category: 'MANGA',
  genres: ['Mystery'],
  cover: '/icon.svg',
  readingState: 'metadata-only',
  availableIntegrations: [],
};

test('Ara enters on Suwayomi and offers one-click integration switches', async ({
  context,
  page,
  baseURL,
}) => {
  const { requests } = await fixture({ context, page, baseURL });
  await page.addInitScript(() =>
    localStorage.setItem(
      'yoru:reader-integration-modes:guest:v1',
      JSON.stringify({ yoru: 'core', 'ara-ara': 'all' }),
    ),
  );
  await page.goto('/ara-ara/manga');
  await page.getByRole('button', { name: 'I’m 18 or older' }).click();
  const controls = page.getByRole('group', { name: 'Catalog integration', exact: true }).first();
  const extensions = controls.getByRole('button', { name: 'Suwayomi extensions', exact: true });
  await expect(extensions).toHaveAttribute('aria-pressed', 'true');
  await expect(
    page.getByRole('combobox', { name: 'Catalog integration', exact: true }),
  ).toHaveCount(0);
  await expect(
    page
      .getByRole('region', { name: 'Enabled reading catalogs', exact: true })
      .locator('.poster-card'),
  ).toHaveCount(1);
  const firstReads = requests.filter(
    (url) =>
      url.pathname === '/api/reader/discovery' && url.searchParams.get('destination') === 'ara-ara',
  );
  expect(firstReads.length).toBeGreaterThan(0);
  expect(firstReads.every((url) => url.searchParams.get('integration') === 'extensions')).toBe(
    true,
  );
  await controls.getByRole('button', { name: 'All sources', exact: true }).click();
  await expect(controls.getByRole('button', { name: 'All sources', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await navigateCollection(page, 'Back to Yoru', true);
  await page.goto('/ara-ara/manga');
  await page.getByRole('button', { name: 'I’m 18 or older' }).click();
  await expect(extensions).toHaveAttribute('aria-pressed', 'true');
  expect(
    await page.evaluate(
      () => JSON.parse(localStorage.getItem('yoru:reader-integration-modes:guest:v1')).yoru,
    ),
  ).toBe('core');
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
});

test('Ara extension discovery keeps the featured banner and working genre choices', async ({
  context,
  page,
  baseURL,
}, testInfo) => {
  const { requests, forbidden } = await fixture({ context, page, baseURL });
  await page.goto('/ara-ara/manga');
  await page.getByRole('button', { name: 'I’m 18 or older' }).click();
  await page
    .getByRole('group', { name: 'Catalog integration', exact: true })
    .first()
    .getByRole('button', { name: 'Suwayomi extensions', exact: true })
    .click();
  const hero = page.getByRole('region', { name: 'Featured manga', exact: true });
  await expect(hero.getByRole('heading', { name: adult.title, exact: true })).toBeVisible();
  const catalog = page.getByRole('region', { name: 'Enabled reading catalogs', exact: true });
  const genres = catalog.getByRole('navigation', { name: 'Explore reading genres' });
  const discoveryCalls = requests.filter((url) => url.pathname === '/api/reader/discovery').length;
  await genres.getByRole('button', { name: 'Fantasy', exact: true }).click();
  await expect(catalog.locator('.poster-card')).toHaveCount(1);
  await genres.getByRole('button', { name: 'Romance', exact: true }).click();
  await expect(catalog.locator('.poster-card')).toHaveCount(0);
  await genres.getByRole('button', { name: 'All genres', exact: true }).click();
  await expect(catalog.locator('.poster-card')).toHaveCount(1);
  await expect(page.locator('.manga-intro')).toHaveCount(0);
  expect(requests.filter((url) => url.pathname === '/api/reader/discovery')).toHaveLength(
    discoveryCalls,
  );
  expect(forbidden).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  await page.screenshot({ path: testInfo.outputPath('ara-discovery.png'), fullPage: true });
  await hero.getByRole('link', { name: 'Explore manga', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/ara-ara/title/${adult.id}`));
});

test('URL genre round trips replace local genre overrides', async ({ context, page, baseURL }) => {
  await fixture({ context, page, baseURL });
  await page.goto('/browse/manga?genre=Fantasy');
  const catalog = page.getByRole('region', { name: 'Enabled reading catalogs', exact: true });
  const genres = catalog.getByRole('navigation', { name: 'Explore reading genres' });
  await genres.getByRole('button', { name: 'All genres', exact: true }).click();
  const dropdown = page.getByRole('combobox', { name: 'Genre', exact: true });
  await dropdown.selectOption('Romance');
  await expect(genres.getByRole('button', { name: 'Romance', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(catalog.locator('.poster-card')).toHaveCount(0);
  await dropdown.selectOption('Fantasy');
  await expect(genres.getByRole('button', { name: 'Fantasy', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(catalog.locator('.poster-card')).toHaveCount(2);
});

for (const mode of ['extensions', 'all']) {
  test(`native search failure remains retryable with core success in ${mode} mode`, async ({
    context,
    page,
    baseURL,
  }) => {
    await fixture({ context, page, baseURL });
    let calls = 0;
    let fail = true;
    await page.route('**/api/reader/suggestions?*', (route) => {
      calls++;
      return fail
        ? route.fulfill({ status: 503, json: { error: 'Native catalog unavailable' } })
        : route.fulfill({ json: { items: [safe] } });
    });
    await page.goto('/browse/manga?q=native');
    await page
      .getByRole('group', { name: 'Catalog integration', exact: true })
      .first()
      .getByRole('button', {
        name: mode === 'all' ? 'All sources' : 'Suwayomi extensions',
        exact: true,
      })
      .click();
    const search = page.getByRole('combobox', { name: 'Search anime, manga, and manhwa' });
    await search.fill('native');
    await expect(page.locator('.search-status')).toContainText('Search is temporarily limited');
    await expect(page.getByRole('button', { name: 'Retry search', exact: true })).toBeVisible();
    await expect(page.getByRole('option').filter({ hasText: core.title })).toHaveCount(
      mode === 'all' ? 1 : 0,
    );
    await expect(page.locator('.search-status')).not.toContainText('No titles found');
    const failedCalls = calls;
    await search.press('Escape');
    await search.click();
    await expect.poll(() => calls).toBeGreaterThan(failedCalls);
    await expect(page.getByRole('button', { name: 'Retry search', exact: true })).toBeVisible();
    fail = false;
    await page.getByRole('button', { name: 'Retry search', exact: true }).click();
    await expect(page.getByRole('option').filter({ hasText: safe.title })).toBeVisible();
    await expect(page.getByRole('option').filter({ hasText: core.title })).toHaveCount(
      mode === 'all' ? 1 : 0,
    );
    await expect(page.getByRole('button', { name: 'Retry search', exact: true })).toHaveCount(0);
  });
}

test('exact mapped core recommendations remain visible in extensions mode', async ({
  context,
  page,
  baseURL,
}) => {
  await fixture({ context, page, baseURL });
  const mapped = {
    ...core,
    title: 'Mapped native fantasy',
    genres: ['Fantasy'],
    cover: '/icon.svg?mapped',
    readingChoices: [
      {
        mediaId: core.id,
        integration: 'core',
        sourceRef: { id: 'mangadex', integration: 'core', providerKey: 'MangaDex' },
      },
      { mediaId: french.id, integration: 'suwayomi', sourceRef: french.sourceRef },
    ],
    availableIntegrations: ['core', 'suwayomi'],
  };
  await page.route('**/api/reader/discovery?*', (route) =>
    route.fulfill({
      json: {
        items: [mapped],
        hasMore: false,
        sourceStates: [],
        selectionFingerprint: new URL(route.request().url()).searchParams.get(
          'selectionFingerprint',
        ),
      },
    }),
  );
  await page.goto('/browse/manga?q=native');
  await page
    .getByRole('group', { name: 'Catalog integration', exact: true })
    .first()
    .getByRole('button', { name: 'Suwayomi extensions', exact: true })
    .click();
  await page.getByRole('link', { name: `View ${safe.title}`, exact: true }).click();
  await expect(
    page
      .getByRole('region', { name: 'Recommendations', exact: true })
      .getByRole('link', { name: mapped.title, exact: true }),
  ).toHaveAttribute('href', `/title/${core.id}`);
});

// These fixtures exercise the real browser consumer and both serving runtimes.
// Native backend persistence/eligibility is separately proven by extension-account contracts.
async function fixture({ context, page, baseURL }) {
  const requests = [];
  const forbidden = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (
      url.hostname === 'private.invalid' ||
      /\/api\/media\/ext-manga-[a-f0-9]+\/(?:episodes|video|stream)/.test(url.pathname)
    )
      forbidden.push(url.href);
  });
  const saved = [];
  await context.route('**/*', (route) =>
    new URL(route.request().url()).origin === baseURL ? route.continue() : route.abort(),
  );
  await page.route('**/api/config', (route) => route.fulfill({ json: { realtime: {}, auth: {} } }));
  await page.route('**/api/ara-ara/catalog*', (route) =>
    route.fulfill({ json: { items: [], total: 0 } }),
  );
  await page.route('**/api/catalog?*', (route) =>
    route.fulfill({ json: { items: [core], total: 1, pages: 1 } }),
  );
  await page.route('**/api/search/suggestions?*', (route) =>
    route.fulfill({ json: { items: [core] } }),
  );
  await page.route('**/api/reader/catalogs*', (route) =>
    route.fulfill({
      json: {
        sources: [safe.sourceRef, french.sourceRef, adult.sourceRef],
        complete: true,
        hasMore: false,
      },
    }),
  );
  const feed = (route) => {
    const url = new URL(route.request().url());
    requests.push(url);
    const mode = url.searchParams.get('integration');
    const items = (
      mode === 'core' ? [core] : mode === 'extensions' ? [safe, french] : [core, safe, french]
    ).filter(
      (item) =>
        (!url.searchParams.get('source') ||
          item.sourceRef?.id === url.searchParams.get('source')) &&
        (!url.searchParams.get('language') ||
          item.sourceRef?.language === url.searchParams.get('language')),
    );
    const destination = url.searchParams.get('destination');
    return route.fulfill({
      json: {
        items: destination === 'ara-ara' && mode !== 'core' ? [adult] : items,
        updates: [],
        hasMore: false,
        nextCursor: null,
        total: null,
        totalIsEstimate: true,
        selectionFingerprint: url.searchParams.get('selectionFingerprint'),
        sourceStates: [],
      },
    });
  };
  await page.route(/\/api\/reader\/(?:browse|discovery|suggestions)(?:\?|$)/, feed);
  await page.route(/\/api\/(?:reader\/)?media\/ext-manga-[a-f0-9]+(?:\?|$)/, (route) => {
    const url = new URL(route.request().url());
    requests.push(url);
    return route.fulfill({ json: { media: url.pathname.includes(adult.id) ? adult : safe } });
  });
  await page.route(/\/api\/media\/ext-manga-[a-f0-9]+\/cover/, (route) => {
    requests.push(new URL(route.request().url()));
    return route.fulfill({ status: 404, body: '' });
  });
  await page.route(/\/api\/media\/ext-manga-[a-f0-9]+\/reading-sources/, (route) =>
    route.fulfill({ json: { sources: [] } }),
  );
  await page.route(/\/api\/library(?:\?|$)/, (route) => route.fulfill({ json: { items: saved } }));
  await page.route(/\/api\/library\/ext-manga-[a-f0-9]+/, async (route) => {
    const body = route.request().postDataJSON();
    const item = { mediaId: safe.id, media: safe, ...body };
    saved.splice(0, saved.length, item);
    return route.fulfill({ json: { item } });
  });
  return { requests, saved, forbidden };
}

test('enabled remote catalog titles browse and save without MAL', async ({
  context,
  page,
  baseURL,
}, testInfo) => {
  const { requests, saved, forbidden } = await fixture({ context, page, baseURL });
  await context.request.post('/api/auth/register', {
    headers: { Origin: baseURL },
    data: {
      name: 'Native discovery reader',
      email: `discovery-${Date.now()}-${Math.random()}@example.test`,
      password: 'Native discovery test 2026',
    },
  });
  await page.goto('/browse/manga?q=native');
  const card = page.locator('.poster-card').filter({ hasText: safe.title });
  await expect(card).toBeVisible();
  await expect(card).toContainText('MangaDex');
  const filterLayout = await page
    .getByRole('region', { name: 'Reading catalog filters' })
    .evaluate((element) => ({
      viewport: innerWidth,
      overflow: document.documentElement.scrollWidth > innerWidth,
      controls: [...element.querySelectorAll('select')].map((select) => ({
        label:
          select.getAttribute('aria-label') ||
          select.closest('label')?.querySelector('span')?.textContent,
        value: select.selectedOptions[0]?.textContent,
        width: Math.round(select.getBoundingClientRect().width),
      })),
    }));
  console.log('Native catalog filter layout:', JSON.stringify(filterLayout));
  expect(filterLayout.overflow).toBe(false);
  await page.screenshot({ path: testInfo.outputPath('native-browse.png'), fullPage: true });
  await card.getByRole('link', { name: `View ${safe.title}`, exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/title/${safe.id}`));
  await expect(page.getByRole('heading', { name: safe.title, exact: true })).toBeVisible();
  await expect(page.locator('.manga-title-stats')).not.toContainText('MAL');
  await page.screenshot({ path: testInfo.outputPath('native-title.png'), fullPage: true });
  await page.getByRole('button', { name: 'Add to favorites', exact: true }).click();
  await expect.poll(() => saved.length).toBe(1);
  await page.goto('/library');
  await page.reload();
  await expect(page.getByRole('link', { name: safe.title, exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('native-library.png'), fullPage: true });
  expect(
    requests.some(
      (url) => /\/cover$/.test(url.pathname) && url.searchParams.get('destination') === 'yoru',
    ),
  ).toBe(true);
  expect(forbidden).toEqual([]);
});

test('source and language filters use native identity and preserve manga classification', async ({
  context,
  page,
  baseURL,
}) => {
  const { requests } = await fixture({ context, page, baseURL });
  await page.goto('/browse/manga?q=native');
  const shelf = page.getByRole('region', { name: 'Enabled reading catalogs', exact: true });
  await expect(shelf.getByRole('link', { name: `View ${safe.title}`, exact: true })).toBeVisible();
  await shelf.getByLabel('Reading language', { exact: true }).selectOption('fr');
  await expect(
    shelf.getByRole('link', { name: `View ${french.title}`, exact: true }),
  ).toBeVisible();
  await expect(shelf.getByRole('link', { name: `View ${safe.title}`, exact: true })).toHaveCount(0);
  await shelf.getByLabel('Reading source', { exact: true }).selectOption('suwayomi:789');
  await expect
    .poll(() =>
      requests.some(
        (url) =>
          url.searchParams.get('source') === 'suwayomi:789' &&
          url.searchParams.get('language') === 'fr',
      ),
    )
    .toBe(true);
  await page.goto('/browse/manhwa?q=native');
  await expect(page.locator('.reader-catalog .poster-card')).toHaveCount(0);
});

test('integration and destination filters apply to cards suggestions and covers', async ({
  context,
  page,
  baseURL,
}) => {
  const { requests } = await fixture({ context, page, baseURL });
  await page.goto('/browse/manga?q=native');
  const integration = page.getByRole('group', { name: 'Catalog integration', exact: true }).first();
  await expect(page.getByRole('link', { name: `View ${safe.title}`, exact: true })).toBeVisible();
  await integration.getByRole('button', { name: 'MangaDex + Weeb Central', exact: true }).click();
  await expect(page.getByRole('link', { name: `View ${safe.title}`, exact: true })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'View Death Note', exact: true })).toBeVisible();
  await integration.getByRole('button', { name: 'Suwayomi extensions', exact: true }).click();
  await expect(page.getByRole('link', { name: `View ${safe.title}`, exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'View Death Note', exact: true })).toHaveCount(0);
  const search = page.getByRole('combobox', { name: 'Search anime, manga, and manhwa' });
  await search.fill('native');
  await expect(page.getByRole('option').filter({ hasText: safe.title })).toBeVisible();
  await expect(page.getByRole('option').filter({ hasText: core.title })).toHaveCount(0);
  await search.press('Escape');
  expect(requests.filter((url) => url.pathname.includes(adult.id))).toHaveLength(0);
  await page.route('**/api/ara-ara/catalog*', (route) =>
    route.fulfill({ status: 503, json: { error: 'Editorial shelf unavailable' } }),
  );
  await page.goto(`/ara-ara/title/${adult.id}`);
  await expect(page.getByRole('heading', { name: 'Adults only', exact: true })).toBeVisible();
  expect(requests.filter((url) => url.searchParams.get('destination') === 'ara-ara')).toHaveLength(
    0,
  );
  await page.getByRole('button', { name: 'I’m 18 or older' }).click();
  await expect(page.getByRole('heading', { name: adult.title, exact: true })).toBeVisible();
  await expect(page.locator('.manga-title-stats')).toContainText('NHentai.to');
  expect(
    requests
      .filter((url) => url.pathname.includes(adult.id))
      .every((url) => url.searchParams.get('destination') === 'ara-ara'),
  ).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
});

test('late feed responses cannot restore a previous integration or disabled source', async ({
  context,
  page,
  baseURL,
}) => {
  await fixture({ context, page, baseURL });
  let release;
  let started = false;
  const held = new Promise((resolve) => {
    release = resolve;
  });
  await page.route('**/api/reader/browse*', async (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get('integration') === 'all') {
      started = true;
      await held;
    }
    await route
      .fulfill({
        json: {
          items: url.searchParams.get('integration') === 'core' ? [core] : [safe],
          updates: [],
          hasMore: false,
          total: null,
        },
      })
      .catch(() => {});
  });
  await page.goto('/browse/manga?q=late');
  await expect.poll(() => started).toBe(true);
  const integration = page.getByRole('group', { name: 'Catalog integration', exact: true }).first();
  await integration.getByRole('button', { name: 'MangaDex + Weeb Central', exact: true }).click();
  await expect(
    integration.getByRole('button', { name: 'MangaDex + Weeb Central', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
  release();
  await expect(page.getByRole('link', { name: `View ${safe.title}`, exact: true })).toHaveCount(0);
  await integration.getByRole('button', { name: 'Suwayomi extensions', exact: true }).click();
  await expect(page.getByRole('link', { name: `View ${safe.title}`, exact: true })).toBeVisible();
  await page.evaluate(() => {
    localStorage.setItem(
      'yoru:catalog-overrides:guest:v1',
      JSON.stringify({ MangaDex: { yoru: false } }),
    );
    window.dispatchEvent(new Event('storage'));
  });
  await expect(page.getByRole('link', { name: `View ${safe.title}`, exact: true })).toHaveCount(0);
});

test('filtered empty pages offer continuation and apply terminal exact-choice updates', async ({
  context,
  page,
  baseURL,
}) => {
  await fixture({ context, page, baseURL });
  await page.route('**/api/reader/browse*', (route) => {
    const url = new URL(route.request().url());
    const cursor = Number(url.searchParams.get('cursor') || 0);
    const choice = (index) => ({
      mediaId: `ext-manga-${String(index).padStart(32, '0')}`,
      integration: 'suwayomi',
      sourceRef: safe.sourceRef,
    });
    return route.fulfill({
      json: {
        items: cursor === 1 ? [{ ...safe, readingChoices: [choice(1)] }] : [],
        updates: cursor > 1 ? [{ id: safe.id, readingChoices: [choice(cursor)] }] : [],
        sourceStates:
          cursor === 0
            ? [
                {
                  sourceId: 'suwayomi:123',
                  state: 'unavailable',
                  reason: 'rate-limited',
                  retryAt: '2026-10-19T12:00:00Z',
                },
              ]
            : [],
        hasMore: cursor < 6,
        nextCursor: cursor < 6 ? String(cursor + 1) : null,
        total: null,
        totalIsEstimate: true,
      },
    });
  });
  await page.goto('/browse/manga?q=continuation');
  const shelf = page.getByRole('region', { name: 'Enabled reading catalogs', exact: true });
  await expect(shelf).toContainText('No matches in this batch');
  await expect(shelf).toContainText('Some sources are unavailable');
  await shelf.getByText('Source availability', { exact: true }).click();
  await expect(shelf).toContainText('rate limited');
  for (let index = 1; index <= 6; index++)
    await shelf.getByRole('button', { name: 'Load more titles', exact: true }).click();
  await expect(shelf.getByRole('link', { name: `View ${safe.title}`, exact: true })).toHaveCount(1);
  await expect(shelf).toContainText('6 reading editions');
  await expect(shelf.getByRole('button', { name: 'Load more titles', exact: true })).toHaveCount(0);
  await expect(shelf).toContainText('Total unknown');
});

test('account and destination changes discard deferred discovery from the previous view', async ({
  context,
  page,
  baseURL,
}) => {
  await fixture({ context, page, baseURL });
  const credentials = {
    name: 'Catalog account switch',
    email: `catalog-switch-${Date.now()}-${Math.random()}@example.test`,
    password: 'Catalog switch test 2026',
  };
  expect(
    (
      await context.request.post('/api/auth/register', {
        headers: { Origin: baseURL },
        data: credentials,
      })
    ).status(),
  ).toBe(201);
  await context.request.post('/api/auth/logout', { headers: { Origin: baseURL }, data: {} });
  let release;
  let started = false;
  let accountView = false;
  const held = new Promise((resolve) => {
    release = resolve;
  });
  page.on('response', (response) => {
    if (new URL(response.url()).pathname === '/api/auth/login' && response.ok()) accountView = true;
  });
  await page.route(/\/api\/reader\/(?:browse|discovery)(?:\?|$)/, async (route) => {
    const current = accountView;
    const destination = new URL(route.request().url()).searchParams.get('destination');
    if (!current) {
      started = true;
      await held;
    }
    await route
      .fulfill({
        json: {
          items: destination === 'ara-ara' ? [adult] : current ? [french] : [safe],
          hasMore: false,
          total: null,
        },
      })
      .catch(() => {});
  });
  await page.goto('/browse/manga?q=account');
  await expect.poll(() => started).toBe(true);
  await page.getByRole('button', { name: 'Sign in', exact: true }).first().click();
  const login = page.getByRole('dialog', { name: 'Sign in to Yoru' });
  await login.getByLabel('Email', { exact: true }).fill(credentials.email);
  await login.getByLabel('Password', { exact: true }).fill(credentials.password);
  await login.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(login).toHaveCount(0);
  await expect(page.getByRole('link', { name: `View ${french.title}`, exact: true })).toBeVisible();
  release();
  await expect(page.getByRole('link', { name: `View ${safe.title}`, exact: true })).toHaveCount(0);
  await navigateCollection(page, 'NSFW · Ara Ara, 18+');
  await expect(page.getByRole('heading', { name: 'Adults only', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'I’m 18 or older' }).click();
  await page
    .getByRole('tablist', { name: 'Homepage category' })
    .getByRole('tab', { name: 'Manga', exact: true })
    .click();
  await expect(
    page.getByRole('link', { name: `View ${adult.title}`, exact: true }).first(),
  ).toBeVisible();
  await expect(page.getByRole('link', { name: `View ${french.title}`, exact: true })).toHaveCount(
    0,
  );
});
