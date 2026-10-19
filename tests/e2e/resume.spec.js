import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { readerImage } from '../fixtures/reader-image.mjs';

const chapter = '11111111-2222-4333-8444-555555555555';
const manga = 'mal-manga-21',
  anime = 'mal-anime-52991',
  manhwa = 'mal-manga-121496';
async function setup(context, baseURL) {
  await context.route('**/*', (route) =>
    new URL(route.request().url()).origin === baseURL ? route.continue() : route.abort(),
  );
  await context.route('**/api/media/*/sources?*', (route) => {
    const url = new URL(route.request().url());
    return route.fulfill({
      json: {
        mediaId: anime,
        episode: Number(url.searchParams.get('episode')),
        language: url.searchParams.get('language'),
        items: [
          { id: 'test', kind: 'video', url: `${baseURL}/resume-test.webm`, label: 'Test video' },
        ],
      },
    });
  });
  await context.route('**/resume-test.webm', (route) =>
    route.fulfill({
      contentType: 'video/webm',
      headers: { 'Accept-Ranges': 'bytes' },
      body: readFileSync(new URL('./fixtures/sync.webm', import.meta.url)),
    }),
  );
  await context.route('**/api/media/*/reading-sources', (route) =>
    route.fulfill({ json: { state: 'ready', sources: [{ id: 'mangadex', name: 'MangaDex' }] } }),
  );
  await context.route('**/api/media/*/chapters?*', (route) =>
    route.fulfill({ json: { state: 'ready', items: [], total: 0 } }),
  );
  await context.route(/\/api\/media\/[^/]+\/reader\/[^/?]+$/, (route) => {
    const path = new URL(route.request().url()).pathname;
    return route.fulfill({
      json: {
        id: chapter,
        kind: 'remote',
        number: '1',
        title: 'Test chapter',
        language: 'en',
        group: 'Test',
        pages: [0, 1, 2].map((n) => ({ url: `${path}/page/${n}` })),
      },
    });
  });
  await context.route('**/api/media/*/reader/*/page/*', (route) =>
    route.fulfill({ contentType: 'image/png', body: readerImage() }),
  );
}
async function selectPage(page, value) {
  if (!(await page.getByLabel('Page number', { exact: true }).isVisible())) {
    const reveal = page.getByRole('button', {
      name: 'Show chapter and page controls',
      exact: true,
    });
    if (await reveal.isVisible()) await reveal.click();
    await page.getByRole('button', { name: 'Reader menu', exact: true }).click();
  }
  await page.getByLabel('Page number', { exact: true }).selectOption(String(value));
}
test('watch and chapter progress follow the account to a fresh device and stay private', async ({
  page,
  context,
  browser,
  baseURL,
}, testInfo) => {
  await setup(context, baseURL);
  const credentials = {
    name: 'Resume reader',
    email: `${randomUUID()}@example.test`,
    password: 'Account resume testing 2026',
  };
  expect(
    (
      await context.request.post('/api/auth/register', {
        headers: { Origin: baseURL },
        data: credentials,
      })
    ).status(),
  ).toBe(201);
  const read = async () => (await (await context.request.get('/api/resume')).json()).items;
  await page.goto(`/watch/${anime}/3?language=dub`);
  const video = page.locator('video');
  await expect.poll(() => video.evaluate((v) => v.readyState)).toBeGreaterThanOrEqual(2);
  await video.evaluate((v) => {
    v.currentTime = 3;
  });
  await expect.poll(() => video.evaluate((v) => v.currentTime)).toBeCloseTo(3, 0);
  await expect
    .poll(async () => (await read()).find((x) => x.mediaId === anime)?.position)
    .toBeCloseTo(3, 0);
  await page.goto(`/read/${manga}/1?chapter=${chapter}&language=en`);
  await expect(page.getByRole('img', { name: 'Chapter 1, page 1', exact: true })).toBeVisible();
  await selectPage(page, 2);
  await expect.poll(async () => (await read()).find((x) => x.mediaId === manga)?.page).toBe(2);
  await page.goto(`/read/${manhwa}/1?chapter=${chapter}&language=en&page=2`);
  await expect.poll(async () => (await read()).find((x) => x.mediaId === manhwa)?.page).toBe(2);

  const second = await browser.newContext({ baseURL });
  try {
    await setup(second, baseURL);
    expect(
      (
        await second.request.post('/api/auth/login', {
          headers: { Origin: baseURL },
          data: credentials,
        })
      ).ok(),
    ).toBeTruthy();
    const other = await second.newPage();
    await other.goto('/');
    const rail = other.getByRole('region', { name: 'Pick up where you left off' });
    await expect(rail.locator('.continue-reading-card')).toHaveCount(3);
    await expect(rail).not.toContainText('On this device');
    await expect(rail).not.toContainText('Your saved progress');
    await expect(rail.getByRole('link', { name: /Death Note/ })).toContainText('Page 2');
    await rail.screenshot({ path: testInfo.outputPath('resume-rail.png') });
    await rail.getByRole('link', { name: /Death Note/ }).click();
    await expect(other.getByRole('img', { name: 'Chapter 1, page 2', exact: true })).toBeVisible();
    await other.goto(`/watch/${anime}/3?language=dub`);
    await expect
      .poll(() => other.locator('video').evaluate((v) => v.currentTime))
      .toBeCloseTo(3, 0);
    // Reloading a cached account page after logout must not disclose its history.
    await second.request.post('/api/auth/logout', { headers: { Origin: baseURL }, data: {} });
    await other.goto('/');
    await expect(other.getByRole('button', { name: 'Sign in', exact: true }).first()).toBeVisible();
    await expect(rail).toHaveCount(0);
    await second.request.post('/api/auth/register', {
      headers: { Origin: baseURL },
      data: { ...credentials, email: `${randomUUID()}@example.test` },
    });
    await other.reload();
    await expect(rail).toHaveCount(0);
  } finally {
    await second.close();
  }
});

test('interrupted progress saves survive reload and sync on reconnect', async ({
  page,
  context,
  baseURL,
}) => {
  await setup(context, baseURL);
  // Intercept fetch itself: Chromium can send unload keepalive requests outside
  // Playwright routing after the document has gone away.
  await context.addInitScript(() => {
    const original = window.fetch;
    window.fetch = (...args) => {
      if (
        localStorage.getItem('resume-test-offline') &&
        String(args[0]).startsWith('/api/resume/') &&
        args[1]?.method === 'PUT'
      )
        return Promise.reject(new TypeError('Simulated offline connection'));
      return original(...args);
    };
  });
  await context.request.post('/api/auth/register', {
    headers: { Origin: baseURL },
    data: {
      name: 'Offline reader',
      email: `${randomUUID()}@example.test`,
      password: 'Account resume testing 2026',
    },
  });
  const remotePage = async () =>
    (await (await context.request.get('/api/resume')).json()).items.find((x) => x.mediaId === manga)
      ?.page;
  await page.goto(`/read/${manga}/1?chapter=${chapter}`);
  await expect.poll(remotePage).toBe(1);
  await page.evaluate(() => localStorage.setItem('resume-test-offline', '1'));
  await selectPage(page, 3);
  await expect
    .poll(() =>
      page.evaluate(() =>
        Object.keys(localStorage)
          .filter((key) => key.startsWith('yoru:resume:'))
          .some((key) => JSON.parse(localStorage.getItem(key)).pending['mal-manga-21']?.page === 3),
      ),
    )
    .toBe(true);
  await page.goto('/');
  await expect(page.getByRole('region', { name: 'Pick up where you left off' })).toContainText(
    'Page 3',
  );
  expect(await remotePage()).toBe(1);
  await page.evaluate(() => {
    localStorage.removeItem('resume-test-offline');
    window.dispatchEvent(new Event('online'));
  });
  await expect.poll(remotePage).toBe(3);
});

test('active video and Watch state survive deferred background resume refresh and failure', async ({
  page,
  context,
  baseURL,
}) => {
  await setup(context, baseURL);
  const registered = await context.request.post('/api/auth/register', {
    headers: { Origin: baseURL },
    data: {
      name: 'Refresh viewer',
      email: `${randomUUID()}@example.test`,
      password: 'Account refresh testing 2026',
    },
  });
  expect(registered.status()).toBe(201);
  const user = (await registered.json()).user;
  const item = {
    mediaId: anime,
    title: 'Initial full history proof',
    category: 'ANIME',
    destination: 'yoru',
    number: 3,
    position: 1,
    updatedAt: Date.now(),
  };
  await context.addInitScript(
    ({ user, item }) =>
      localStorage.setItem(
        `yoru:resume:${user.id}`,
        JSON.stringify({ items: [item], pending: { [item.mediaId]: item } }),
      ),
    { user, item },
  );
  const gate = () => {
    let enter, release;
    return {
      entered: new Promise((resolve) => {
        enter = resolve;
      }),
      released: new Promise((resolve) => {
        release = resolve;
      }),
      enter: () => enter(),
      release: () => release(),
      status: 200,
    };
  };
  let held = gate(),
    puts = 0;
  const gates = [held];
  await context.route(/\/api\/library(?:\?|$)/, (route) => route.fulfill({ json: { items: [] } }));
  await context.route(`**/api/resume/${anime}*`, (route) => {
    puts++;
    return route.fulfill({ json: { item: route.request().postDataJSON() } });
  });
  await context.route(/\/api\/resume(?:\?|$)/, async (route) => {
    const requestGate = held;
    requestGate.enter();
    await requestGate.released;
    await route.fulfill({
      status: requestGate.status,
      json: requestGate.status === 200 ? { items: [item] } : { error: 'Unavailable' },
    });
  });
  const settleRender = () =>
    page.evaluate(
      () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
    );
  const samePlayer = () =>
    page.evaluate(
      () =>
        document.querySelector('video') === window.refreshTestVideo &&
        window.refreshTestVideo?.isConnected,
    );
  try {
    await page.goto(`/watch/${anime}/3`);
    await held.entered;
    expect(puts).toBeGreaterThan(0);
    await expect(page.locator('video')).toHaveCount(0); // PUT cannot settle initial GET readiness.
    held.release();
    const video = page.locator('video');
    await expect.poll(() => video.evaluate((v) => v.readyState)).toBeGreaterThanOrEqual(2);
    await page.getByRole('button', { name: 'Theater', exact: true }).click();
    await video.evaluate(async (v) => {
      window.refreshTestVideo = v;
      v.muted = true;
      v.loop = true;
      v.volume = 0.37;
      v.playbackRate = 0.25;
      v.currentTime = 1;
      await v.play();
    });
    held = gate();
    gates.push(held);
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await held.entered;
    await settleRender();
    expect(await samePlayer(), 'pending background GET retains the exact active video node').toBe(
      true,
    );
    const received = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === '/api/resume' && response.request().method() === 'GET',
    );
    held.release();
    await received;
    await settleRender();
    expect(await samePlayer()).toBe(true);
    await expect(page.getByRole('button', { name: 'Theater', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect.poll(() => video.evaluate((v) => v.currentTime)).toBeGreaterThanOrEqual(1);
    expect(await video.evaluate((v) => ({ paused: v.paused, volume: v.volume }))).toEqual({
      paused: false,
      volume: 0.37,
    });
    held = gate();
    held.status = 500;
    gates.push(held);
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await held.entered;
    await settleRender();
    expect(await samePlayer()).toBe(true);
    const failed = page.waitForResponse(
      (response) => new URL(response.url()).pathname === '/api/resume' && response.status() === 500,
    );
    held.release();
    await failed;
    await settleRender();
    expect(await samePlayer(), 'failed background GET must not destroy active playback').toBe(true);
    await expect(page.getByRole('button', { name: 'Theater', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(await video.evaluate((v) => v.paused)).toBe(false);
    await expect.poll(() => video.evaluate((v) => v.currentTime)).toBeGreaterThanOrEqual(1);
    await page.goto('/');
    const rail = page.getByRole('region', { name: 'Pick up where you left off' });
    await expect(rail).toContainText('Reading history could not be verified.');
    await expect(rail.locator('.continue-reading-card')).toHaveCount(0);
    expect(
      await page.evaluate(
        (owner) =>
          JSON.parse(localStorage.getItem(`yoru:resume:${owner}`)).items.some(
            (item) => item.mediaId === 'mal-anime-52991',
          ),
        user.id,
      ),
    ).toBe(true);
  } finally {
    for (const requestGate of gates) requestGate.release();
  }
});
