import { test, expect } from '@playwright/test';
import { readerImage } from '../fixtures/reader-image.mjs';

const mediaId = `ext-manga-${'1'.repeat(32)}`;
const chapterId = `ext-chapter-${'2'.repeat(32)}`;
const specialId = `ext-chapter-${'3'.repeat(32)}`;
const coreId = '12345678-1234-4234-8234-123456789abc';
const sourceRef = {
  id: 'suwayomi:42',
  integration: 'suwayomi',
  providerKey: 'MangaDex',
  language: 'es',
  classification: { rating: 'safe', provenance: { sourceField: 'fixture', value: 'safe' } },
};
const media = {
  id: mediaId,
  category: 'MANGA',
  title: 'Exact edition story',
  sourceRef,
  classification: {
    rating: 'safe',
    provenance: { sourceField: 'title.contentRating', value: 'safe' },
  },
  isAdult: false,
  genres: [],
  externalLinks: [],
};
const extensionChoice = {
  id: sourceRef.id,
  name: 'MangaDex · Suwayomi',
  sourceRef,
  mediaId,
  integration: 'suwayomi',
  state: 'ready',
};
const coreChoice = {
  id: 'mangadex',
  name: 'MangaDex · Core',
  mediaId: 'mal-manga-21',
  integration: 'core',
  state: 'ready',
};
const nativeChapter = (id = chapterId, number = '0') => ({
  id,
  mediaId,
  sourceRef,
  integration: 'suwayomi',
  number,
  language: 'es',
  volume: '',
  title: id === specialId ? 'An exact special' : 'Prologue',
  groups: [],
  native: true,
  pages: 3,
});
const coreChapter = {
  id: coreId,
  mediaId: 'mal-manga-21',
  number: '7.5',
  language: 'en',
  source: 'mangadex',
  native: true,
  groups: [],
  title: 'Verified core edition',
  pages: 3,
};
const link = (destination = 'yoru') =>
  `${destination === 'ara-ara' ? '/ara-ara' : ''}/read/${mediaId}/0?chapter=${chapterId}&source=suwayomi%3A42&language=es&page=2`;

async function fixture(page, context, baseURL) {
  const calls = [];
  let fail = false;
  await context.route('**/*', (route) =>
    new URL(route.request().url()).origin === baseURL ? route.continue() : route.abort(),
  );
  await page.route('**/api/config', (route) => route.fulfill({ json: { realtime: {}, auth: {} } }));
  await page.route('**/api/media/**', async (route) => {
    const url = new URL(route.request().url());
    if (!url.pathname.includes(mediaId) && !url.pathname.includes('mal-manga-21'))
      return route.continue();
    calls.push(url);
    const core = url.pathname.includes('mal-manga-21');
    if (/\/page\/\d+$/.test(url.pathname))
      return route.fulfill({ contentType: 'image/png', body: readerImage() });
    if (url.pathname.includes('/reader/')) {
      if (fail)
        return route.fulfill({ status: 503, json: { error: 'This selected source is offline.' } });
      const id = url.pathname.split('/').at(-1);
      const chapter = core ? coreChapter : nativeChapter(id, id === specialId ? 'Extra' : '0');
      return route.fulfill({
        json: {
          ...chapter,
          kind: 'remote',
          group: 'Fixture edition',
          pages: [0, 1, 2].map((i) => ({
            url: `/api/media/${chapter.mediaId}/reader/${id}/page/${i}?destination=${url.searchParams.get('destination') || 'yoru'}`,
          })),
        },
      });
    }
    if (url.pathname.endsWith('/reading-sources')) {
      const mode = url.searchParams.get('integration');
      return route.fulfill({
        json: {
          state: 'ready',
          sources:
            mode === 'core'
              ? [coreChoice]
              : mode === 'extensions'
                ? [extensionChoice]
                : [extensionChoice, coreChoice],
        },
      });
    }
    if (url.pathname.endsWith('/chapters'))
      return route.fulfill({
        json: {
          state: 'ready',
          items: core ? [coreChapter] : [nativeChapter(), nativeChapter(specialId, 'Extra')],
          languages: core ? ['en'] : ['es'],
          groups: [],
          total: core ? 1 : 2,
          nextOffset: null,
          hasMore: false,
        },
      });
    return route.fulfill({
      json: { media: core ? { ...media, id: 'mal-manga-21', sourceRef: undefined } : media },
    });
  });
  return {
    calls,
    fail: () => {
      fail = true;
    },
  };
}
async function menu(page) {
  if (await page.getByLabel('Page number', { exact: true }).isVisible()) return;
  const reveal = page.getByRole('button', { name: 'Show chapter and page controls', exact: true });
  if (await reveal.isVisible()) await reveal.click();
  await page.getByRole('button', { name: 'Reader menu', exact: true }).click();
}

test('pinned native edition keeps page when browse mode changes and deliberate switch chooses exact DTO', async ({
  page,
  context,
  baseURL,
}, testInfo) => {
  const { calls } = await fixture(page, context, baseURL);
  await page.goto(link());
  await expect(page.getByRole('img', { name: 'Chapter 0, page 2', exact: true })).toBeVisible();
  await menu(page);
  const selector = page.getByRole('combobox', { name: 'Catalog integration', exact: true });
  const filteredTitle = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return (
      url.pathname === `/api/media/${mediaId}` && url.searchParams.get('integration') === 'core'
    );
  });
  await selector.selectOption('core');
  await filteredTitle;
  await expect(page.getByRole('img', { name: 'Chapter 0, page 2', exact: true })).toBeVisible();
  await menu(page);
  await expect(selector).toHaveValue('core');
  await expect(page.getByLabel('Page number', { exact: true })).toHaveValue('2');
  await page.screenshot({ path: testInfo.outputPath('exact-edition-mode-core-page2.png') });
  expect(new URL(page.url()).searchParams.get('chapter')).toBe(chapterId);
  const sources = page.getByLabel('Reading source', { exact: true });
  await expect(sources.locator('option[value="suwayomi:42"]')).toHaveCount(1);
  await expect(sources.locator('option[value="mangadex"]')).toHaveCount(1);
  await sources.selectOption('mangadex');
  expect(new URL(page.url()).searchParams.get('chapter')).toBe(chapterId);
  await page.getByRole('button', { name: /Read chapter 7.5/ }).click();
  await expect(page).toHaveURL(new RegExp(`/read/mal-manga-21/7.5\\?.*chapter=${coreId}`));
  await expect(page.getByRole('img', { name: 'Chapter 7.5, page 1', exact: true })).toBeVisible();
  expect(
    calls
      .filter((url) => /\/chapters$|\/reading-sources$|\/reader\/[^/]+$/.test(url.pathname))
      .every((url) => url.searchParams.has('selectionFingerprint')),
  ).toBe(true);
  const saved = await page.evaluate(
    ({ mediaId, chapterId }) =>
      JSON.parse(localStorage.getItem(`yoru:reader:state:${mediaId}`)).chapters[chapterId],
    { mediaId, chapterId },
  );
  expect(saved.page).toBe(2);
  await page.goto(link());
  await expect(page.getByRole('img', { name: 'Chapter 0, page 2', exact: true })).toBeVisible();
});

test('exact specials survive reload and a failed source never substitutes imported pages', async ({
  page,
  context,
  baseURL,
}) => {
  const { fail } = await fixture(page, context, baseURL);
  const url = link().replace(`/0?chapter=${chapterId}`, `/1?chapter=${specialId}`);
  await page.goto(url);
  await expect(page.getByRole('img', { name: 'Chapter Extra, page 2', exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('img', { name: 'Chapter Extra, page 2', exact: true })).toBeVisible();
  await page.evaluate(async (mediaId) => {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open('yoru-reader', 1);
      request.onupgradeneeded = () =>
        request.result.createObjectStore('collections', { keyPath: 'mediaId' });
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    await new Promise((resolve, reject) => {
      const transaction = db.transaction('collections', 'readwrite');
      transaction.objectStore('collections').put({
        mediaId,
        chapters: [
          {
            id: 'manifest:unrelated',
            number: '0',
            language: 'en',
            group: 'Unrelated import',
            pages: [{ url: 'https://images.example.org/imported.png' }],
          },
        ],
      });
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error);
    });
    db.close();
  }, mediaId);
  fail();
  await page.reload();
  await expect(page.getByText('This selected source is offline.', { exact: true })).toBeVisible();
  await expect(page.locator('.reader-canvas')).toHaveCount(0);
  expect(new URL(page.url()).searchParams.get('chapter')).toBe(specialId);
});

test('renewing the guest lease keeps the pinned edition, page and mounted canvas', async ({
  page,
  context,
  baseURL,
}) => {
  await page.clock.install({ time: new Date() });
  const { calls } = await fixture(page, context, baseURL);
  let leases = 0;
  page.on('response', (response) => {
    if (
      new URL(response.url()).pathname === '/api/reader/context' &&
      response.request().method() === 'POST' &&
      response.ok()
    )
      leases++;
  });
  await page.goto(link());
  await expect(page.getByRole('img', { name: 'Chapter 0, page 2', exact: true })).toBeVisible();
  await menu(page);
  const filteredTitle = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return (
      url.pathname === `/api/media/${mediaId}` && url.searchParams.get('integration') === 'core'
    );
  });
  await page
    .getByRole('combobox', { name: 'Catalog integration', exact: true })
    .selectOption('core');
  await filteredTitle;
  await expect(page.getByRole('img', { name: 'Chapter 0, page 2', exact: true })).toBeVisible();
  await menu(page);
  await expect(
    page.getByRole('combobox', { name: 'Catalog integration', exact: true }),
  ).toHaveValue('core');
  const before = leases;
  const manifestsBefore = calls.filter((url) =>
    url.pathname.endsWith(`/reader/${chapterId}`),
  ).length;
  const href = page.url();
  await page.evaluate(() => {
    window.leaseCanvas = document.querySelector('.reader-canvas');
  });
  await page.clock.fastForward(24 * 60_000 + 1000);
  await expect.poll(() => leases).toBeGreaterThan(before);
  await expect(page.getByRole('img', { name: 'Chapter 0, page 2', exact: true })).toBeVisible();
  expect(page.url()).toBe(href);
  expect(
    await page.evaluate(() => window.leaseCanvas === document.querySelector('.reader-canvas')),
  ).toBe(true);
  expect(calls.filter((url) => url.pathname.endsWith(`/reader/${chapterId}`))).toHaveLength(
    manifestsBefore,
  );
  await expect(page.getByLabel('Page number', { exact: true })).toHaveValue('2');
});

test('Ara reader and room stay quiet before confirmation', async ({ page, context, baseURL }) => {
  const { calls } = await fixture(page, context, baseURL);
  const rooms = [];
  await page.route('**/api/rooms**', (route) => {
    rooms.push(route.request().url());
    return route.fulfill({ json: { items: [] } });
  });
  await page.goto(link('ara-ara'));
  await expect(page.getByRole('heading', { name: 'Adults only', exact: true })).toBeVisible();
  expect(calls).toEqual([]);
  expect(rooms).toEqual([]);
  await page.goto('/ara-ara/rooms');
  await expect(page.getByRole('heading', { name: 'Adults only', exact: true })).toBeVisible();
  expect(rooms).toEqual([]);
});

test('Ara room iframe preserves its exact native edition and host selects a special by ID', async ({
  page,
  context,
  baseURL,
}) => {
  await fixture(page, context, baseURL);
  const registration = await context.request.post('/api/auth/register', {
    headers: { Origin: baseURL },
    data: {
      name: 'Exact room host',
      email: `reader-room-${Date.now()}-${Math.random()}@example.test`,
      password: 'Reader room fixture password 2026',
    },
  });
  expect(registration.status()).toBe(201);
  const { user } = await registration.json();
  expect(
    (
      await context.request.patch('/api/reader/preferences', {
        headers: { Origin: baseURL },
        data: {
          owner: user.id,
          operation: 'membership',
          provider: 'MangaDex',
          destination: 'ara-ara',
          enabled: true,
        },
      })
    ).status(),
  ).toBe(200);
  let room = {
    id: 'exact-reader-room',
    name: 'An exact Ara chapter',
    mediaId,
    media,
    destination: 'ara-ara',
    type: 'read',
    unit: 0,
    sourceKind: 'reader',
    sourceUrl: link('ara-ara'),
    readerSourceId: sourceRef.id,
    readerEditionId: chapterId,
    hostId: user.id,
    joined: true,
    visibility: 'public',
    capacity: 8,
    memberCount: 1,
    members: [user],
    version: 1,
    paused: true,
    position: 0,
  };
  const requests = [],
    patches = [];
  await page.route('**/api/rooms/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    requests.push(url);
    if (url.pathname.endsWith('/chat')) return route.fulfill({ json: { items: [] } });
    if (request.method() === 'PATCH') {
      const patch = request.postDataJSON();
      patches.push(patch);
      room = { ...room, ...patch, version: room.version + 1 };
    }
    return route.fulfill({ json: { room } });
  });
  await page.goto('/ara-ara/rooms/exact-reader-room');
  await expect(page.getByRole('heading', { name: 'Adults only', exact: true })).toBeVisible();
  expect(requests).toEqual([]);
  await page.getByRole('button', { name: 'I’m 18 or older' }).click();
  const frame = page.frameLocator('iframe.room-reader');
  await expect(page.locator('iframe.room-reader')).toHaveAttribute('src', link('ara-ara'));
  await expect(frame.getByRole('img', { name: 'Chapter 0, page 2', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Invite friends', exact: true }).click();
  const invitation = page.getByRole('dialog', { name: 'Invite friends', exact: true });
  expect(
    new URL(await invitation.getByLabel('Room invitation', { exact: true }).inputValue()).pathname,
  ).toBe('/ara-ara/rooms/exact-reader-room');
  await invitation.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await page.getByRole('button', { name: 'Choose exact chapter edition', exact: true }).click();
  await page.getByRole('button', { name: /Read chapter Extra/ }).click();
  await expect.poll(() => patches.length).toBe(1);
  expect(patches[0].sourceUrl).toContain(specialId);
  expect(patches[0].sourceUrl).toContain('/ara-ara/read/');
  expect(patches[0].sourceUrl).toContain('source=suwayomi%3A42');
  await expect(
    frame.getByRole('img', { name: 'Chapter Extra, page 1', exact: true }),
  ).toBeVisible();
  expect(requests.every((url) => url.searchParams.get('destination') === 'ara-ara')).toBe(true);
  expect(requests.every((url) => url.searchParams.has('selectionFingerprint'))).toBe(true);
});

test('a disabled selected core source exposes its single enabled alternative without fetching disabled pages', async ({
  page,
  context,
  baseURL,
}) => {
  const { calls } = await fixture(page, context, baseURL);
  await page.addInitScript(() =>
    localStorage.setItem(
      'yoru:catalog-overrides:guest:v1',
      JSON.stringify({ MangaDex: { yoru: false } }),
    ),
  );
  await page.route('**/api/media/mal-manga-21/reading-sources**', (route) =>
    route.fulfill({
      json: {
        state: 'ready',
        sources: [
          { id: 'weebcentral', name: 'Weeb Central', mediaId: 'mal-manga-21', integration: 'core' },
        ],
      },
    }),
  );
  const target = { ...coreChapter, id: 'sw-weebcentral-1-2', source: 'weebcentral', number: '3.5' };
  await page.route('**/api/media/mal-manga-21/chapters**', (route) =>
    route.fulfill({
      json: {
        state: 'ready',
        items: [target],
        languages: ['en'],
        groups: [],
        nextOffset: null,
        total: 1,
      },
    }),
  );
  await page.route('**/api/media/mal-manga-21/reader/sw-weebcentral-1-2**', (route) => {
    if (route.request().url().includes('/page/'))
      return route.fulfill({ contentType: 'image/png', body: readerImage() });
    return route.fulfill({
      json: {
        ...target,
        kind: 'remote',
        pages: [{ url: '/api/media/mal-manga-21/reader/sw-weebcentral-1-2/page/0' }],
      },
    });
  });
  await page.goto(`/read/mal-manga-21/1?chapter=${coreId}&source=mangadex&page=2`);
  await expect(
    page.getByText(
      'This chapter source is disabled for this section. Choose another source or change Reader catalogs in Settings.',
      { exact: true },
    ),
  ).toBeVisible();
  const source = page.getByLabel('Reading source', { exact: true });
  await expect(source.locator('option[value="weebcentral"]')).toHaveCount(1);
  await source.selectOption('weebcentral');
  expect(new URL(page.url()).searchParams.get('chapter')).toBe(coreId);
  await page.getByRole('button', { name: /Read chapter 3.5/ }).click();
  await expect(page.getByRole('img', { name: 'Chapter 3.5, page 1', exact: true })).toBeVisible();
  expect(calls.some((url) => url.pathname.includes(`/reader/${coreId}`))).toBe(false);
});

test('a disabled native title offers only verified eligible alternatives and keeps its old page until selection', async ({
  page,
  context,
  baseURL,
}) => {
  const { calls } = await fixture(page, context, baseURL);
  await page.addInitScript(() =>
    localStorage.setItem(
      'yoru:catalog-overrides:guest:v1',
      JSON.stringify({ MangaDex: { yoru: false } }),
    ),
  );
  await page.route(`**/api/media/${mediaId}?*`, (route) =>
    route.fulfill({ status: 404, json: { error: 'Title unavailable in this section.' } }),
  );
  const alternatives = [];
  await page.route(`**/api/reader/media/${mediaId}/alternatives**`, (route) => {
    const url = new URL(route.request().url());
    alternatives.push(url);
    if (!url.searchParams.has('cursor'))
      return route.fulfill({
        json: { choices: [], incomplete: true, sourceStates: [], nextCursor: 'verified-next' },
      });
    expect(url.searchParams.get('cursor')).toBe('verified-next');
    return route.fulfill({
      json: {
        choices: [
          {
            mediaId: 'mal-manga-21',
            integration: 'core',
            sourceRef: {
              id: 'weebcentral',
              integration: 'core',
              providerKey: 'Weeb Central',
              language: 'en',
            },
            upstreamRef: null,
            state: 'unresolved',
          },
        ],
        incomplete: false,
        sourceStates: [],
      },
    });
  });
  const target = { ...coreChapter, id: 'sw-weebcentral-1-2', source: 'weebcentral', number: '3.5' };
  await page.route('**/api/media/mal-manga-21/chapters**', (route) =>
    route.fulfill({
      json: { state: 'ready', items: [target], languages: ['en'], nextOffset: null },
    }),
  );
  await page.route('**/api/media/mal-manga-21/reader/sw-weebcentral-1-2**', (route) =>
    route.request().url().includes('/page/')
      ? route.fulfill({ contentType: 'image/png', body: readerImage() })
      : route.fulfill({
          json: {
            ...target,
            pages: [{ url: '/api/media/mal-manga-21/reader/sw-weebcentral-1-2/page/0' }],
          },
        }),
  );
  await page.goto(link());
  await expect(
    page.getByRole('heading', { name: 'This chapter source is unavailable here.' }),
  ).toBeVisible();
  await expect(page.getByText(media.title, { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Check more sources', exact: true }).click();
  await page.getByLabel('Reading source', { exact: true }).selectOption('mal-manga-21:weebcentral');
  expect(new URL(page.url()).searchParams.get('page')).toBe('2');
  expect(new URL(page.url()).searchParams.get('chapter')).toBe(chapterId);
  await page.getByRole('button', { name: /Read chapter 3.5/ }).click();
  await expect(page.getByRole('img', { name: 'Chapter 3.5, page 1', exact: true })).toBeVisible();
  expect(calls.filter((url) => url.pathname.includes(mediaId))).toEqual([]);
  expect(
    alternatives.every(
      (url) =>
        url.searchParams.get('destination') === 'yoru' &&
        url.searchParams.has('selectionFingerprint'),
    ),
  ).toBe(true);
});

test('a wrong-destination native reader shows no denied metadata or guessed fallback', async ({
  page,
  context,
  baseURL,
}) => {
  const { calls } = await fixture(page, context, baseURL);
  await page.route(`**/api/media/${mediaId}?*`, (route) =>
    route.fulfill({ status: 404, json: { error: 'Title unavailable in this section.' } }),
  );
  await page.route(`**/api/reader/media/${mediaId}/alternatives**`, (route) =>
    route.fulfill({ status: 404, json: { error: 'No eligible alternative.' } }),
  );
  await page.goto(link());
  await expect(
    page.getByText(
      'No verified alternative is available in this integration group. Change the group or Reader catalogs in Settings.',
      { exact: true },
    ),
  ).toBeVisible();
  await expect(page.locator('.reader-canvas')).toHaveCount(0);
  await expect(page.getByText(media.title, { exact: true })).toHaveCount(0);
  expect(calls).toEqual([]);
  expect(new URL(page.url()).searchParams.get('chapter')).toBe(chapterId);
});
