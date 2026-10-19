import { navigatePrimary } from './navigation';
import { test as base, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { accountSource, accountClassification } from '../extension-account-contract.mjs';

const FRIEREN = 'mal-anime-52991';
const SOLO_LEVELING_MANHWA = 'mal-manga-121496';
const blockExternal = (context, baseURL) =>
  context.route('**/*', (route) =>
    new URL(route.request().url()).origin === baseURL
      ? route.continue()
      : route.abort('blockedbyclient'),
  );
const test = base.extend({
  context: async ({ context, baseURL }, use) => {
    // The suite never contacts a video host, OAuth provider, or image CDN.
    await blockExternal(context, baseURL);
    await use(context);
  },
  page: async ({ page }, use) => {
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await use(page);
    expect(errors, 'No uncaught application errors').toEqual([]);
  },
});

function account() {
  const suffix = randomUUID().slice(0, 8);
  return {
    name: `Reader ${suffix}`,
    email: `reader-${suffix}@example.test`,
    password: 'Yoru test password 2026',
  };
}

async function toolRegistry(page) {
  await page.addInitScript(() => {
    window.__yoruTestTools = {};
    Object.defineProperty(document, 'modelContext', {
      configurable: true,
      value: {
        registerTool(tool, options = {}) {
          window.__yoruTestTools[tool.name] = tool;
          options.signal?.addEventListener('abort', () => {
            delete window.__yoruTestTools[tool.name];
          });
        },
      },
    });
  });
}
async function toolsReady(page) {
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const tool = window.__yoruTestTools?.yoru_get_page_state;
        return tool ? !(await tool.execute({})).isError : false;
      }),
    )
    .toBe(true);
}

test('catalog retries saved results immediately and enables live pagination', async ({ page }) => {
  let requests = 0;
  await page.route('**/api/catalog?**', async (route) => {
    requests++;
    await route.fulfill({
      json: {
        items: [],
        total: requests === 1 ? 12 : 22500,
        page: 1,
        pages: requests === 1 ? 1 : 938,
        providerUnavailable: requests === 1,
        totalIsEstimate: requests === 1,
        source: requests === 1 ? 'offline-cache' : 'MyAnimeList and Kitsu',
      },
    });
  });
  await page.goto('/browse/anime?view=all');
  await expect(page.getByText('12 saved stories available')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Next', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Retry live catalog' }).click();
  await expect(page.getByText('22,500 stories to discover')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Next', exact: true })).toBeEnabled();
  expect(requests).toBe(2);
});

async function registerApi(request, baseURL, user = account()) {
  const response = await request.post('/api/auth/register', {
    headers: { Origin: baseURL },
    data: user,
  });
  expect(response.status(), await response.text()).toBe(201);
  return user;
}

test('live startup retries configuration and reconciles a library changed before connection', async ({
  page,
  baseURL,
}) => {
  await registerApi(page.request, baseURL);
  let configRequests = 0,
    releaseConfig;
  const ready = new Promise((resolve) => {
    releaseConfig = resolve;
  });
  await page.route('**/api/config', async (route) => {
    configRequests++;
    if (configRequests === 1) {
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Temporary outage' }),
      });
    } else {
      await ready;
      await route.continue();
    }
  });
  await page.goto(`/title/${FRIEREN}`);
  await expect(page.getByRole('button', { name: 'Add to list', exact: true })).toBeVisible();
  const changed = await page.request.put(`/api/library/${FRIEREN}`, {
    headers: { Origin: baseURL },
    data: { status: 'watching', progress: 7 },
  });
  expect(changed.ok(), await changed.text()).toBeTruthy();
  releaseConfig();
  await expect(page.getByRole('button', { name: 'In your library', exact: true })).toBeVisible({
    timeout: 10000,
  });
  await expect(page.getByLabel('Progress', { exact: true })).toHaveValue('7');
  // Account initialization can already observe the changed row. Configuration
  // recovery has its own retry timer, so verify that behavior independently.
  await expect.poll(() => configRequests).toBeGreaterThanOrEqual(2);
  const config = await (await page.request.get('/api/config')).json();
  if (config.realtime.transport === 'poll') {
    // A logout in another tab clears the shared cookie without changing this page's React state.
    const logout = await page.request.post('/api/auth/logout', {
      headers: { Origin: baseURL },
      data: {},
    });
    expect(logout.ok()).toBeTruthy();
    await expect(page.getByRole('button', { name: 'Sign in', exact: true }).first()).toBeVisible({
      timeout: 10000,
    });
    await expect(page.getByRole('button', { name: 'Add to list', exact: true })).toBeVisible();
  }
});

test('browse anime, manga, and manhwa on desktop and mobile', async ({ page }) => {
  for (const [category, title] of [
    ['anime', 'Frieren'],
    ['manga', 'Berserk'],
    ['manhwa', 'Solo Leveling'],
  ]) {
    await page.goto(`/browse/${category}?view=all`);
    await expect(page.getByRole('main')).toContainText(title);
    await expect(
      page
        .getByRole('main')
        .getByRole('link', { name: new RegExp(`View .*${title}`) })
        .first(),
    ).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth),
      `${category} should fit the viewport`,
    ).toBeLessThanOrEqual(1);
  }
  await page.getByLabel('Search catalog', { exact: true }).fill('solo leveling');
  await page.getByRole('main').getByRole('button', { name: 'Search', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Results for “solo leveling”', exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('link', { name: 'View Solo Leveling', exact: true })).toBeVisible();
  await page
    .getByLabel('Search catalog', { exact: true })
    .fill('a-title-that-does-not-exist-yoru-test');
  await page.getByRole('main').getByRole('button', { name: 'Search', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'No plot twists here. Just no results.', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Clear search', exact: true }).click();
  await expect(page.getByRole('link', { name: 'View Solo Leveling', exact: true })).toBeVisible();
});

test('register, save a title, reload, and sign back into the same library', async ({
  page,
  baseURL,
}) => {
  const user = account();
  await page.goto(`/title/${FRIEREN}`);
  await page.getByRole('button', { name: 'Sign in', exact: true }).first().click();
  await page.getByRole('button', { name: 'Create an account', exact: true }).click();
  const registration = page.getByRole('dialog', { name: 'Create your Yoru account' });
  await registration.getByLabel('Display name', { exact: true }).fill(user.name);
  await registration.getByLabel('Email', { exact: true }).fill(user.email);
  await registration.getByLabel('Password', { exact: true }).fill(user.password);
  await registration.getByRole('button', { name: 'Create account', exact: true }).click();
  await expect(registration).toBeHidden();
  await page.getByRole('button', { name: 'Add to list', exact: true }).click();
  await page.getByLabel('Progress', { exact: true }).fill('3');
  await page.getByRole('button', { name: 'Save progress', exact: true }).click();
  await expect
    .poll(async () => {
      const data = await (await page.request.get('/api/library')).json();
      return data.items?.find((item) => item.mediaId === FRIEREN)?.progress;
    })
    .toBe(3);
  await page.getByLabel('My status', { exact: true }).selectOption('paused');
  await expect
    .poll(async () => {
      const data = await (await page.request.get('/api/library')).json();
      return data.items?.some(
        (item) => item.mediaId === FRIEREN && item.progress === 3 && item.status === 'paused',
      );
    })
    .toBe(true);

  await page.goto('/library');
  await expect(page.getByRole('main')).toContainText('Frieren');
  await page.reload();
  await expect(page.getByRole('main')).toContainText('Frieren');

  const logout = await page.request.post('/api/auth/logout', {
    headers: { Origin: baseURL },
    data: {},
  });
  expect(logout.ok()).toBe(true);
  await page.reload();
  await page.getByRole('button', { name: 'Sign in', exact: true }).first().click();
  const login = page.getByRole('dialog', { name: 'Sign in to Yoru' });
  await login.getByLabel('Email', { exact: true }).fill(user.email);
  await login.getByLabel('Password', { exact: true }).fill(user.password);
  await login.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(login).toBeHidden();
  await expect(page.getByRole('main')).toContainText('Frieren');
});

test('another account cannot see a saved private library', async ({ page, baseURL }) => {
  await registerApi(page.request, baseURL);
  const save = await page.request.put(`/api/library/${FRIEREN}`, {
    headers: { Origin: baseURL },
    data: { status: 'watching', progress: 3, favorite: true },
  });
  expect(save.ok(), await save.text()).toBe(true);
  await page.request.post('/api/auth/logout', { headers: { Origin: baseURL }, data: {} });
  await registerApi(page.request, baseURL);
  await page.goto('/library');
  const ownLibrary = await (await page.request.get('/api/library')).json();
  expect(ownLibrary.items).toEqual([]);
  await expect(page.getByRole('main')).not.toContainText('Frieren');
});

test('MyAnimeList XML import previews before saving anime and manhwa progress', async ({
  page,
  baseURL,
}) => {
  await registerApi(page.request, baseURL);
  await page.goto('/library');
  await page.getByRole('button', { name: 'Import from MAL', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Import from MyAnimeList', exact: true });
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
    <myanimelist>
      <anime><series_animedb_id>52991</series_animedb_id><series_title>Frieren: Beyond Journey's End</series_title><series_episodes>28</series_episodes><my_status>Watching</my_status><my_watched_episodes>4</my_watched_episodes></anime>
      <manga><manga_mangadb_id>121496</manga_mangadb_id><manga_title>Solo Leveling</manga_title><my_status>Reading</my_status><my_read_chapters>7</my_read_chapters></manga>
    </myanimelist>`;
  await dialog.getByLabel('MyAnimeList XML file', { exact: true }).setInputFiles({
    name: 'fictional-test-list.xml',
    mimeType: 'application/xml',
    buffer: Buffer.from(xml),
  });
  await expect(dialog).toContainText('2 stories ready to come home');
  const before = await (await page.request.get('/api/library')).json();
  expect(before.items).toEqual([]);
  await dialog.getByRole('button', { name: 'Import 2 titles', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('main')).toContainText('Frieren');
  await expect(page.getByRole('main')).toContainText('Solo Leveling');
  const saved = await (await page.request.get('/api/library')).json();
  expect(saved.items.map((item) => [item.mediaId, item.progress, item.status])).toEqual(
    expect.arrayContaining([
      [FRIEREN, 4, 'watching'],
      [SOLO_LEVELING_MANHWA, 7, 'reading'],
    ]),
  );
  await page.reload();
  await expect(page.getByRole('main')).toContainText('Chapter 7');
});

test('public MAL favorites require sign-in and an unavailable provider leaves the library unchanged', async ({
  page,
  baseURL,
}) => {
  await page.goto('/library');
  const opener = page.getByRole('button', { name: 'Import MAL favorites', exact: true });
  await expect(opener).toBeInViewport();
  await opener.click();
  await expect(page.getByRole('dialog', { name: 'Sign in to Yoru', exact: true })).toBeVisible();
  await expect(
    page.getByRole('dialog', { name: 'Import public MAL favorites', exact: true }),
  ).toBeHidden();

  await registerApi(page.request, baseURL);
  const saved = await page.request.put(`/api/library/${FRIEREN}`, {
    headers: { Origin: baseURL },
    data: { status: 'watching', progress: 6, favorite: true },
  });
  expect(saved.ok(), await saved.text()).toBe(true);
  const before = await (await page.request.get('/api/library')).json();
  await page.goto('/library');
  await expect(page.getByRole('main')).toContainText('Episode 6');
  await expect(opener).toBeInViewport();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth),
    'Library import actions should fit the viewport',
  ).toBeLessThanOrEqual(1);
  await opener.click();
  const dialog = page.getByRole('dialog', { name: 'Import public MAL favorites', exact: true });
  await dialog.getByLabel('MyAnimeList username', { exact: true }).fill('Public_User');
  const response = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === '/api/import/favorites/preview' &&
      response.request().method() === 'POST',
  );
  await dialog.getByRole('button', { name: 'Preview favorites', exact: true }).click();
  expect((await response).status()).toBe(503);
  await expect(dialog.getByRole('alert')).toContainText(
    'Public favorites lookup is unavailable in offline mode. Your library is unchanged',
  );
  await expect(dialog.getByRole('button', { name: /^Import \d+ favorites$/ })).toHaveCount(0);
  const after = await (await page.request.get('/api/library')).json();
  expect(after.items).toEqual(before.items);
  await dialog.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await page.reload();
  await expect(page.getByRole('main')).toContainText('Episode 6');
});

test('stacked import and sign-in dialogs close one at a time and restore scrolling and focus', async ({
  page,
}) => {
  await page.goto('/library');
  const originalOverflow = await page.evaluate(() => document.body.style.overflow);
  const opener = page.getByRole('button', { name: 'Import from MAL', exact: true });
  await opener.click();
  const importer = page.getByRole('dialog', { name: 'Import from MyAnimeList', exact: true });
  const xml =
    '<myanimelist><anime><series_animedb_id>52991</series_animedb_id><series_title>Frieren</series_title><my_status>Watching</my_status><my_watched_episodes>1</my_watched_episodes></anime></myanimelist>';
  await importer.getByLabel('MyAnimeList XML file', { exact: true }).setInputFiles({
    name: 'signed-out-preview.xml',
    mimeType: 'application/xml',
    buffer: Buffer.from(xml),
  });
  const commit = importer.getByRole('button', { name: 'Import 1 titles', exact: true });
  await commit.click();
  const auth = page.getByRole('dialog', { name: 'Sign in to Yoru', exact: true });
  await expect(auth).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(2);
  expect(await auth.evaluate((dialog) => dialog.contains(document.activeElement))).toBe(true);

  await page.keyboard.press('Escape');
  await expect(auth).toBeHidden();
  await expect(importer).toBeVisible();
  await expect(commit).toBeFocused();
  expect(await page.evaluate(() => document.body.style.overflow)).toBe('hidden');

  await page.keyboard.press('Escape');
  await expect(importer).toBeHidden();
  await expect(opener).toBeFocused();
  expect(await page.evaluate(() => document.body.style.overflow)).toBe(originalOverflow);
});

test('top navigation keeps settings next to the account control without a side menu', async ({
  page,
}) => {
  await page.goto('/schedule');
  await expect(page.getByRole('button', { name: 'Open navigation', exact: true })).toHaveCount(0);
  await expect(page.locator('.sidebar')).toHaveCount(0);
  const header = page.locator('.topbar');
  const settings = header.getByRole('link', { name: 'Settings', exact: true });
  const signIn = header.getByRole('button', { name: 'Sign in', exact: true });
  await expect(settings).toBeVisible();
  const signBox = await signIn.boundingBox();
  const settingsBox = await settings.boundingBox();
  expect(settingsBox.x).toBeGreaterThan(signBox.x + signBox.width);
  expect(Math.abs(settingsBox.y - signBox.y)).toBeLessThan(10);
  await signIn.focus();
  await page.keyboard.press('Tab');
  await expect(settings).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/settings$/);
  await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
  await navigatePrimary(page, 'My Space');
  await page
    .getByRole('navigation', { name: 'My Space sections' })
    .getByRole('link', { name: 'Library', exact: true })
    .click();
  await expect(page).toHaveURL(/\/library$/);
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
});

test('WebMCP tools register, search, and honor the active account session', async ({
  page,
  baseURL,
}) => {
  // Exercise the adapter deterministically; native WebMCP availability is browser-dependent.
  await page.addInitScript(() => {
    window.__yoruTestTools = {};
    const modelContext = {
      registerTool(tool, options = {}) {
        window.__yoruTestTools[tool.name] = tool;
        options.signal?.addEventListener('abort', () => {
          delete window.__yoruTestTools[tool.name];
        });
      },
      unregisterTool(name) {
        delete window.__yoruTestTools[name];
      },
    };
    Object.defineProperty(document, 'modelContext', { configurable: true, value: modelContext });
  });
  await page.goto('/');
  await expect.poll(() => page.evaluate(() => Object.keys(window.__yoruTestTools).length)).toBe(10);
  await toolsReady(page);
  const catalog = await page.evaluate(() =>
    window.__yoruTestTools.yoru_search_catalog.execute({ query: 'Frieren', category: 'ANIME' }),
  );
  expect(JSON.parse(catalog.content[0].text).items.map((item) => item.id)).toContain(FRIEREN);
  const anonymousWrite = await page.evaluate(
    (mediaId) => window.__yoruTestTools.yoru_update_library.execute({ mediaId, favorite: true }),
    FRIEREN,
  );
  expect(anonymousWrite.isError).toBe(true);

  await registerApi(page.request, baseURL);
  await page.reload();
  await expect.poll(() => page.evaluate(() => Object.keys(window.__yoruTestTools).length)).toBe(10);
  await toolsReady(page);
  const saved = await page.evaluate(
    (mediaId) =>
      window.__yoruTestTools.yoru_update_library.execute({
        mediaId,
        favorite: true,
        status: 'planned',
      }),
    FRIEREN,
  );
  expect(saved.isError).not.toBe(true);
  const library = await page.evaluate(() => window.__yoruTestTools.yoru_get_library.execute({}));
  expect(JSON.parse(library.content[0].text).items).toEqual(
    expect.arrayContaining([expect.objectContaining({ mediaId: FRIEREN, favorite: true })]),
  );
  await page.evaluate(
    (mediaId) => window.__yoruTestTools.yoru_open_title.execute({ mediaId }),
    FRIEREN,
  );
  await expect(page).toHaveURL(new RegExp(`/title/${FRIEREN}$`));
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Frieren');
  const aborted = await page.evaluate((mediaId) => {
    const controller = new AbortController();
    controller.abort();
    return window.__yoruTestTools.yoru_open_episode.execute(
      { mediaId },
      { signal: controller.signal },
    );
  }, FRIEREN);
  expect(aborted.isError).toBe(true);
  expect(JSON.parse(aborted.content[0].text).code).toBe('CANCELLED');
  await expect(page).toHaveURL(new RegExp(`/title/${FRIEREN}$`));
  const wrongNamespace = await page.evaluate(
    (mediaId) => window.__yoruTestTools.yoru_get_sources.execute({ mediaId }),
    SOLO_LEVELING_MANHWA,
  );
  expect(wrongNamespace.isError).toBe(true);
  const resolved = JSON.parse(
    (
      await page.evaluate(
        (mediaId) =>
          window.__yoruTestTools.yoru_get_sources.execute({ mediaId, episode: 2, language: 'dub' }),
        FRIEREN,
      )
    ).content[0].text,
  );
  expect(resolved.items[0].url).toBe('https://megaplay.buzz/stream/mal/52991/2/dub');
  const opened = await page.evaluate(
    (mediaId) =>
      window.__yoruTestTools.yoru_open_episode.execute({ mediaId, episode: 2, language: 'dub' }),
    FRIEREN,
  );
  expect(opened.isError).not.toBe(true);
  expect(JSON.parse(opened.content[0].text).playbackStarted).toBe(false);
  await expect(page.locator('iframe')).toHaveAttribute('src', resolved.items[0].url);
  await expect(page.locator('iframe')).not.toHaveAttribute('sandbox');
  const external = resolved.items.find((x) => x.kind === 'external');
  // The default player can appear before the full provider directory has loaded.
  await expect
    .poll(() =>
      page.evaluate(async (sourceId) => {
        const result = await window.__yoruTestTools.yoru_get_page_state.execute({});
        return JSON.parse(result.content[0].text).sources?.some((item) => item.id === sourceId);
      }, external.id),
    )
    .toBe(true);
  const selected = await page.evaluate(
    (sourceId) => window.__yoruTestTools.yoru_select_source.execute({ sourceId }),
    external.id,
  );
  expect(selected.isError).not.toBe(true);
  await expect(page.getByRole('link', { name: 'Open provider', exact: true })).toHaveAttribute(
    'href',
    external.url,
  );
  const pageState = JSON.parse(
    (await page.evaluate(() => window.__yoruTestTools.yoru_get_page_state.execute({}))).content[0]
      .text,
  );
  expect(pageState.source.id).toBe(external.id);
  expect(pageState.language).toBe('dub');
  await page.getByRole('button', { name: 'MegaPlay', exact: true }).click();
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(page.locator('iframe')).toHaveAttribute(
    'src',
    'https://megaplay.buzz/stream/mal/52991/3/dub',
  );
  await page.getByRole('button', { name: 'Sub', exact: true }).click();
  await expect(page.locator('iframe')).toHaveAttribute(
    'src',
    'https://megaplay.buzz/stream/mal/52991/3/sub',
  );
});

test('optional discovery adds alternatives without replacing the active player', async ({
  page,
}) => {
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  await page.route('**/api/media/*/sources?*', async (route) => {
    await gate;
    const response = await route.fetch();
    const result = await response.json();
    result.items.push({
      ...result.items[0],
      id: 'megaplay-episode',
      label: 'MegaPlay · episode match',
      url: 'https://megaplay.buzz/stream/s-2/123/sub',
    });
    await route.fulfill({ json: result });
  });
  await page.goto(`/watch/${FRIEREN}/1`);
  await expect(page.locator('iframe')).toHaveAttribute(
    'src',
    'https://megaplay.buzz/stream/mal/52991/1/sub',
  );
  release();
  await expect(
    page.getByRole('button', { name: 'MegaPlay · episode match', exact: true }),
  ).toBeVisible();
  await expect(page.locator('iframe')).toHaveAttribute(
    'src',
    'https://megaplay.buzz/stream/mal/52991/1/sub',
  );
});

test('general page tools handle native reading references but anime tools reject them', async ({
  page,
  baseURL,
}) => {
  await registerApi(page.request, baseURL);
  await toolRegistry(page);
  const native = {
    id: 'ext-manga-' + 'a'.repeat(32),
    title: 'Synthetic native tool edition',
    category: 'MANGA',
    sourceRef: accountSource(),
    classification: accountClassification(),
    upstreamRef: { sourceId: 'suwayomi:123', upstreamKey: '/tools/native', language: 'en' },
    provenance: { sourceField: 'synthetic browser fixture' },
    malId: null,
    idMal: null,
    cover: '/icon.svg',
  };
  const calls = [];
  let saved = null;
  // These synthetic responses prove page-tool wiring. Real Node/D1 ownership
  // and adult-source rejection are covered by webmcp-http-contract.mjs.
  await page.route('**/api/reader/browse?*', (route) => {
    calls.push(new URL(route.request().url()));
    return route.fulfill({
      json: {
        items: [native],
        sourceStates: [],
        total: null,
        totalIsEstimate: true,
        nextCursor: null,
        hasMore: false,
      },
    });
  });
  await page.route(new RegExp('/api/media/' + native.id + '(?:\\?|$)'), (route) => {
    calls.push(new URL(route.request().url()));
    return route.fulfill({ json: native });
  });
  await page.route(/\/api\/library(?:\/ext-manga-[a-f0-9]+)?(?:\?|$)/, (route) => {
    calls.push(new URL(route.request().url()));
    if (route.request().method() === 'PUT') {
      saved = { mediaId: native.id, media: native, ...route.request().postDataJSON() };
      return route.fulfill({ json: { item: saved } });
    }
    return route.fulfill({ json: { items: saved ? [saved] : [] } });
  });
  await page.goto('/');
  await toolsReady(page);
  const execute = (name, args) =>
    page.evaluate(
      async ({ name, args }) => {
        const value = await window.__yoruTestTools[name].execute(args);
        return { isError: !!value.isError, body: JSON.parse(value.content[0].text) };
      },
      { name, args },
    );
  const search = await execute('yoru_search_catalog', { query: 'native', category: 'MANGA' });
  expect(search.isError).toBe(false);
  expect(search.body.items.map((x) => x.id)).toContain(native.id);
  const title = await execute('yoru_get_title', { mediaId: native.id });
  expect(title.isError).toBe(false);
  expect(title.body).toMatchObject({
    id: native.id,
    malId: null,
    destination: 'yoru',
    sourceRef: { id: 'suwayomi:123', integration: 'suwayomi' },
  });
  expect(
    (
      await execute('yoru_update_library', {
        mediaId: native.id,
        favorite: true,
        status: 'reading',
      })
    ).isError,
  ).toBe(false);
  expect((await execute('yoru_get_library', {})).body.items).toEqual(
    expect.arrayContaining([expect.objectContaining({ mediaId: native.id, favorite: true })]),
  );
  const before = calls.length;
  for (const name of ['yoru_get_sources', 'yoru_open_episode'])
    expect((await execute(name, { mediaId: native.id })).isError).toBe(true);
  expect(calls.length).toBe(before);
  for (const url of calls) {
    expect(url.searchParams.get('destination')).toBe('yoru');
    if (url.pathname.startsWith('/api/media/') || url.pathname === '/api/reader/browse')
      expect(url.searchParams.get('selectionFingerprint')).toBeTruthy();
  }
});

test('tool arguments cannot cross destination or account ownership', async ({ page, baseURL }) => {
  await registerApi(page.request, baseURL);
  await toolRegistry(page);
  await page.goto('/');
  await toolsReady(page);
  const nativeId = 'ext-manga-' + 'b'.repeat(32);
  let writes = 0;
  page.on('request', (request) => {
    if (request.method() === 'PUT' && request.url().includes('/api/library/')) writes++;
  });
  for (const injected of [
    { owner: 'another-account' },
    { userId: 'another-account' },
    { destination: 'ara-ara' },
  ]) {
    const result = await page.evaluate(
      ({ mediaId, injected }) =>
        window.__yoruTestTools.yoru_update_library.execute({
          mediaId,
          favorite: true,
          ...injected,
        }),
      { mediaId: nativeId, injected },
    );
    expect(result.isError).toBe(true);
  }
  expect(writes).toBe(0);
  // An unowned/unresolved opaque identity is unavailable through the real API.
  // The shared HTTP contract also seeds adult records and proves the same 404.
  const unavailable = await page.evaluate(
    (mediaId) => window.__yoruTestTools.yoru_get_title.execute({ mediaId }),
    nativeId,
  );
  expect(unavailable.isError).toBe(true);
  expect(JSON.parse(unavailable.content[0].text).id).toBeUndefined();
  await page.goto('/ara-ara');
  await expect(page.getByRole('heading', { name: 'Adults only' })).toBeVisible();
  const gated = await page.evaluate(
    (mediaId) => window.__yoruTestTools.yoru_get_title.execute({ mediaId }),
    nativeId,
  );
  expect(gated.isError).toBe(true);
});

test('legacy WebMCP survives strict lifecycle cleanup and reports registration failures', async ({
  page,
}) => {
  await page.addInitScript(() => {
    window.__yoruTestTools = {};
    Object.defineProperty(document, 'modelContext', { configurable: true, value: undefined });
    Object.defineProperty(navigator, 'modelContext', {
      configurable: true,
      value: {
        registerTool(tool) {
          if (window.__yoruTestTools[tool.name]) throw new Error('Duplicate');
          window.__yoruTestTools[tool.name] = tool;
        },
        unregisterTool(name) {
          delete window.__yoruTestTools[name];
        },
      },
    });
  });
  await page.goto('/settings');
  await expect.poll(() => page.evaluate(() => Object.keys(window.__yoruTestTools).length)).toBe(10);
  await toolsReady(page);
  const result = await page.evaluate(() =>
    window.__yoruTestTools.yoru_search_catalog.execute({ query: 'Frieren' }),
  );
  expect(result.isError).not.toBe(true);
  await page.addInitScript(() => {
    Object.defineProperty(document, 'modelContext', {
      configurable: true,
      value: { registerTool: () => Promise.reject(new Error('Unavailable')) },
    });
  });
  await page.reload();
  await expect(page.getByText(/could not register/i)).toBeVisible();
});

test('episode discussions preserve replies and votes without leaking into another episode', async ({
  page,
  baseURL,
}) => {
  const user = await registerApi(page.request, baseURL);
  const body = `A small detail in episode one, ${randomUUID()}`;
  const reply = `That detail made the whole scene work, ${randomUUID()}`;
  await page.goto(`/title/${FRIEREN}?unit=1`);
  await page.getByLabel('Discussion comment', { exact: true }).fill(body);
  await page.getByRole('button', { name: 'Post comment', exact: true }).click();
  const thread = page
    .locator('article.comment')
    .filter({ has: page.getByText(body, { exact: true }) })
    .first();
  await expect(thread.getByText(user.name, { exact: true })).toBeVisible();
  await thread.getByRole('button', { name: 'Reply', exact: true }).click();
  await page.getByLabel('Discussion comment', { exact: true }).fill(reply);
  await page.getByRole('button', { name: 'Post reply', exact: true }).click();
  await expect(thread.getByText(reply, { exact: true })).toBeVisible();

  const upvote = thread
    .getByRole('button', { name: `Like comment by ${user.name}`, exact: true })
    .first();
  const voteValue = async () => {
    const data = await (await page.request.get(`/api/comments/${FRIEREN}?unit=1`)).json();
    return data.items.find((item) => item.body === body)?.viewerVote;
  };
  await upvote.click();
  await expect.poll(voteValue).toBe(1);
  await expect(upvote).toHaveAttribute('aria-pressed', 'true');
  await upvote.click();
  await expect.poll(voteValue).toBe(0);

  await page.getByLabel('Discussion episode', { exact: true }).fill('2');
  await expect(page).toHaveURL(/unit=2/);
  await expect(page.getByText(body, { exact: true })).toBeHidden();
  await expect(page.getByText(reply, { exact: true })).toBeHidden();
  await page.getByLabel('Discussion episode', { exact: true }).fill('1');
  await page.reload();
  await expect(page.getByText(body, { exact: true })).toBeVisible();
  await expect(page.getByText(reply, { exact: true })).toBeVisible();
});

test('a whole-title review shows its rating and author after reload', async ({ page, baseURL }) => {
  const user = await registerApi(page.request, baseURL);
  const title = `A journey worth taking ${randomUUID().slice(0, 8)}`;
  const body = 'The quiet character moments make this story linger long after an episode ends.';
  await page.goto(`/title/${FRIEREN}`);
  await page.getByRole('tab', { name: 'Reviews', exact: true }).click();
  await page.getByRole('button', { name: 'Write a review', exact: true }).click();
  await page.getByLabel('Your rating', { exact: true }).selectOption('9');
  await page.getByLabel('Review title', { exact: true }).fill(title);
  await page.getByLabel('Your review', { exact: true }).fill(body);
  await page.getByRole('button', { name: 'Publish review', exact: true }).click();
  const review = page
    .locator('article')
    .filter({ has: page.getByRole('heading', { name: title, exact: true }) });
  await expect(review).toContainText(user.name);
  await expect(review).toContainText('9/10');
  await page.reload();
  await page.getByRole('tab', { name: 'Reviews', exact: true }).click();
  await expect(review).toContainText(body);
  await expect(review).toContainText(user.name);
});

test('two people create a manhwa room, exchange live messages, and follow the host chapter', async ({
  page,
  browser,
  baseURL,
}) => {
  const host = await registerApi(page.request, baseURL);
  const roomName = `After-hours reading ${randomUUID().slice(0, 8)}`;
  await page.goto('/rooms');
  await page.getByRole('button', { name: 'Create a room', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Create a room', exact: true });
  await dialog.getByLabel('Room name', { exact: true }).fill(roomName);
  await dialog.getByLabel('Room story type', { exact: true }).selectOption('MANHWA');
  await dialog.getByLabel('Room story', { exact: true }).selectOption(SOLO_LEVELING_MANHWA);
  await dialog.getByLabel('Seats', { exact: true }).selectOption('4');
  await dialog.getByRole('button', { name: 'Create room', exact: true }).click();
  await expect(page.getByRole('heading', { name: roomName, exact: true })).toBeVisible();
  await expect(page.getByTestId('room-unit')).toHaveText('1');
  const roomUrl = page.url();
  const roomId = new URL(roomUrl).pathname.split('/').at(-1);

  const guestContext = await browser.newContext({ baseURL, serviceWorkers: 'block' });
  await blockExternal(guestContext, baseURL);
  try {
    const guest = await registerApi(guestContext.request, baseURL);
    const guestPage = await guestContext.newPage();
    await guestPage.goto(roomUrl);
    await guestPage.getByRole('button', { name: 'Join room', exact: true }).first().click();
    await expect(guestPage.getByLabel('Room message', { exact: true })).toBeEnabled();
    await expect(page.getByRole('main')).toContainText(guest.name);
    await expect(guestPage.getByRole('main')).toContainText(host.name);
    await expect(guestPage.getByLabel('Room unit', { exact: true })).toBeHidden();

    const greeting = `Ready for the next chapter ${randomUUID().slice(0, 8)}`;
    await guestPage.getByLabel('Room message', { exact: true }).fill(greeting);
    await guestPage.getByRole('button', { name: 'Send message', exact: true }).click();
    await expect(page.getByText(greeting, { exact: true })).toBeVisible();
    const answer = `Let's read together ${randomUUID().slice(0, 8)}`;
    await page.getByLabel('Room message', { exact: true }).fill(answer);
    await page.getByRole('button', { name: 'Send message', exact: true }).click();
    await expect(guestPage.getByText(answer, { exact: true })).toBeVisible();

    await page.getByLabel('Room unit', { exact: true }).fill('4');
    await page.getByRole('button', { name: 'Go', exact: true }).click();
    await expect(guestPage.getByTestId('room-unit')).toHaveText('4');
    const denied = await guestContext.request.patch(`/api/rooms/${roomId}`, {
      headers: { Origin: baseURL },
      data: { unit: 5 },
    });
    expect(denied.status()).toBe(403);
    await guestPage.reload();
    await expect(guestPage.getByTestId('room-unit')).toHaveText('4');
    await expect(guestPage.getByText(greeting, { exact: true })).toBeVisible();
    await expect(guestPage.getByText(answer, { exact: true })).toBeVisible();
  } finally {
    await guestContext.close();
  }
});

test('a watch room synchronizes real video play, pause, and seeking without a media service', async ({
  page,
  context,
  browser,
  baseURL,
}) => {
  await registerApi(page.request, baseURL);
  await page.goto('/');
  // A small, silent, seekable video authored with FFmpeg's testsrc2 generator.
  const fixtureVideo = readFileSync(new URL('./fixtures/sync.webm', import.meta.url));
  const fixtureUrl = 'https://media.example.test/yoru-fixture.webm';
  const serveFixture = (route) =>
    route.fulfill({
      status: 200,
      contentType: 'video/webm',
      body: fixtureVideo,
      headers: { 'Accept-Ranges': 'bytes' },
    });
  await context.route(fixtureUrl, serveFixture);

  const created = await page.request.post('/api/rooms', {
    headers: { Origin: baseURL },
    data: {
      name: `Video sync ${randomUUID().slice(0, 8)}`,
      mediaId: FRIEREN,
      type: 'watch',
      capacity: 4,
    },
  });
  expect(created.status()).toBe(201);
  const { room } = await created.json();
  const source = await page.request.patch(`/api/rooms/${room.id}`, {
    headers: { Origin: baseURL },
    data: { sourceUrl: fixtureUrl, sourceKind: 'video', paused: true, position: 0 },
  });
  expect(source.ok()).toBe(true);

  const guestContext = await browser.newContext({ baseURL, serviceWorkers: 'block' });
  await blockExternal(guestContext, baseURL);
  await guestContext.route(fixtureUrl, serveFixture);
  try {
    await registerApi(guestContext.request, baseURL);
    const joined = await guestContext.request.post(`/api/rooms/${room.id}/join`, {
      headers: { Origin: baseURL },
      data: {},
    });
    expect(joined.ok()).toBe(true);
    const guestPage = await guestContext.newPage();
    await Promise.all([page.goto(`/rooms/${room.id}`), guestPage.goto(`/rooms/${room.id}`)]);
    const hostVideo = page.locator('video');
    const guestVideo = guestPage.locator('video');
    await expect
      .poll(() => hostVideo.evaluate((video) => video.readyState))
      .toBeGreaterThanOrEqual(2);
    await expect
      .poll(() => guestVideo.evaluate((video) => video.readyState))
      .toBeGreaterThanOrEqual(2);
    await page.getByRole('button', { name: 'Play for everyone', exact: true }).click();
    // Some browsers require a guest gesture even for this silent fixture.
    try {
      await guestPage
        .getByRole('button', { name: 'Join playback', exact: true })
        .click({ timeout: 750 });
    } catch {
      /* Playback may already be allowed. */
    }
    await expect
      .poll(() => guestVideo.evaluate((video) => !video.paused && video.currentTime > 0.2))
      .toBe(true);
    const beforePause = await hostVideo.evaluate((video) => video.currentTime);
    await page.getByRole('button', { name: 'Pause for everyone', exact: true }).click();
    await expect.poll(() => guestVideo.evaluate((video) => video.paused)).toBe(true);
    expect(await guestVideo.evaluate((video) => video.currentTime)).toBeGreaterThanOrEqual(
      beforePause - 0.3,
    );

    await hostVideo.evaluate((video) => {
      video.currentTime = 3;
    });
    await expect.poll(() => guestVideo.evaluate((video) => video.currentTime)).toBeCloseTo(3, 0);
    expect(await guestVideo.evaluate((video) => video.paused)).toBe(true);
  } finally {
    await guestContext.close();
  }
});
