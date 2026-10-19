import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { accountSource, accountClassification } from '../extension-account-contract.mjs';

const native = (suffix, title) => ({
  mediaId: 'ext-manga-' + suffix.repeat(32),
  title,
  category: 'MANGA',
  number: 3,
  page: 8,
  updatedAt: Date.now(),
  destination: 'yoru',
  sourceRef: accountSource(),
  classification: accountClassification(),
  cover: '/icon.svg',
});
async function login(context, baseURL) {
  const result = await context.request.post('/api/auth/register', {
    headers: { Origin: baseURL },
    data: {
      name: 'Account continuation',
      email: `${randomUUID()}@example.test`,
      password: 'Account continuation 2026',
    },
  });
  expect(result.status()).toBe(201);
  return (await result.json()).user;
}

test('real account clients expose source and scan-budget continuations for both views', async ({
  page,
  context,
  baseURL,
}) => {
  await login(context, baseURL);
  const calls = [];
  const first = native('c', 'Beyond source four hundred'),
    last = native('d', 'Beyond scan budget');
  await context.route(/\/api\/(?:library|resume)(?:\?|$)/, (route) => {
    const url = new URL(route.request().url()),
      kind = url.pathname.slice(5);
    calls.push([kind, url.searchParams.get('sourceCursor'), url.searchParams.get('cursor')]);
    const library = kind === 'library';
    const shape = (item) =>
      library
        ? {
            mediaId: item.mediaId,
            media: { ...item, id: item.mediaId },
            status: 'reading',
            progress: 3,
            updatedAt: item.updatedAt,
          }
        : item;
    if (url.searchParams.get('cursor') === 'scan-5000')
      return route.fulfill({
        json: { items: [shape(last)], inventoryComplete: true, recordsComplete: true },
      });
    if (url.searchParams.get('sourceCursor') === 'source-400')
      return route.fulfill({
        json: {
          items: [shape(first)],
          inventoryComplete: true,
          recordsComplete: false,
          scanState: 'incomplete',
          nextCursor: 'scan-5000',
        },
      });
    return route.fulfill({
      json: {
        items: [],
        inventoryComplete: false,
        sourceCursor: 'source-400',
        recordsComplete: true,
      },
    });
  });
  await page.goto('/library');
  await expect(page.getByRole('button', { name: 'Load more saved stories' })).toBeVisible();
  await page.getByRole('button', { name: 'Load more saved stories' }).click();
  await expect(page.getByText(first.title, { exact: true }).first()).toBeVisible();
  await page.getByRole('button', { name: 'Load more saved stories' }).click();
  await expect(page.getByText(last.title, { exact: true }).first()).toBeVisible();
  await expect(page.getByText(first.title, { exact: true }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Load more saved stories' })).toHaveCount(0);
  await page.goto('/');
  const rail = page.getByRole('region', { name: 'Pick up where you left off' });
  await rail.getByRole('button', { name: 'Load more reading history' }).click();
  await expect(rail).toContainText(first.title);
  await rail.getByRole('button', { name: 'Load more reading history' }).click();
  await expect(rail).toContainText(last.title);
  await expect(rail).toContainText(first.title);
  for (const kind of ['library', 'resume']) {
    expect(calls.some(([k, source]) => k === kind && source === 'source-400')).toBeTruthy();
    expect(calls.some(([k, , cursor]) => k === kind && cursor === 'scan-5000')).toBeTruthy();
  }
  await page.goto('/ara-ara');
  await expect(page.getByRole('heading', { name: 'Adults only' })).toBeVisible();
  await expect(page.getByText(first.title)).toHaveCount(0);
});

test('failed full refresh clears previous native authorization but keeps durable history', async ({
  page,
  context,
  baseURL,
}) => {
  const user = await login(context, baseURL),
    item = native('e', 'Previously authorized native history');
  let fail = false;
  await context.route(/\/api\/library(?:\?|$)/, (route) => route.fulfill({ json: { items: [] } }));
  await context.route(/\/api\/resume(?:\?|$)/, (route) =>
    fail
      ? route.fulfill({ status: 500, json: { error: 'Unavailable' } })
      : route.fulfill({ json: { items: [item] } }),
  );
  await page.goto('/');
  await expect(page.getByText(item.title)).toBeVisible();
  fail = true;
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.getByText(item.title)).toHaveCount(0);
  await expect(page.getByText('Reading history could not be verified.')).toBeVisible();
  const saved = await page.evaluate(
    (owner) => JSON.parse(localStorage.getItem(`yoru:resume:${owner}`)),
    user.id,
  );
  expect(saved.items.some((x) => x.mediaId === item.mediaId)).toBeTruthy();
});

test('successful pending PUT cannot authorize history after the full GET fails', async ({
  page,
  context,
  baseURL,
}) => {
  const user = await login(context, baseURL),
    item = native('f', 'Pending PUT is not full view proof');
  await context.addInitScript(
    ({ owner, item }) =>
      localStorage.setItem(
        `yoru:resume:${owner}`,
        JSON.stringify({ items: [item], pending: { [item.mediaId]: item } }),
      ),
    { owner: user.id, item },
  );
  let puts = 0;
  await context.route(/\/api\/library(?:\?|$)/, (route) => route.fulfill({ json: { items: [] } }));
  await context.route(`**/api/resume/${item.mediaId}*`, (route) => {
    puts++;
    return route.fulfill({ json: { item } });
  });
  await context.route(/\/api\/resume(?:\?|$)/, (route) =>
    route.fulfill({ status: 500, json: { error: 'Unavailable' } }),
  );
  await page.goto('/');
  await expect(page.getByText('Reading history could not be verified.')).toBeVisible();
  expect(puts).toBeGreaterThan(0);
  await expect(page.getByText(item.title)).toHaveCount(0);
  const saved = await page.evaluate(
    (owner) => JSON.parse(localStorage.getItem(`yoru:resume:${owner}`)),
    user.id,
  );
  expect(saved.items.some((x) => x.mediaId === item.mediaId)).toBeTruthy();
  expect(saved.pending[item.mediaId]).toBeUndefined();
});

test('guest native history after installed source four hundred has an actionable bounded continuation', async ({
  page,
  context,
}) => {
  const item = native('9', 'Guest source four hundred and six');
  await context.addInitScript(
    (item) =>
      localStorage.setItem(
        'yoru:resume:guest',
        JSON.stringify({
          items: [{ ...item, mediaSnapshot: { ...item, id: item.mediaId } }],
          pending: {},
        }),
      ),
    item,
  );
  const sources = [
    ...Array.from({ length: 405 }, (_, i) =>
      accountSource(String(20000 + i), 'unknown', `Unconfigured ${i}`),
    ),
    accountSource(),
  ];
  let calls = 0;
  await context.route('**/api/reader/catalogs*', (route) => {
    calls++;
    const offset = Number(new URL(route.request().url()).searchParams.get('cursor') || 0);
    return route.fulfill({
      json: {
        sources: sources.slice(offset, offset + 100),
        nextCursor: offset + 100 < sources.length ? String(offset + 100) : null,
        complete: offset + 100 >= sources.length,
      },
    });
  });
  await page.goto('/');
  const button = page.getByRole('button', { name: 'Load more installed sources' });
  await expect(button).toBeEnabled();
  await expect(page.getByText(item.title)).toHaveCount(0);
  expect(calls).toBeLessThanOrEqual(4);
  await button.click();
  await expect(page.getByText(item.title)).toBeVisible();
  await expect(button).toHaveCount(0);
  expect(calls).toBe(5);
});

test('core-only guest progress does not show irrelevant installed-source warnings on outage', async ({
  page,
  context,
}) => {
  const media = {
    id: 'mal-anime-52991',
    title: 'Core guest anime progress',
    category: 'ANIME',
    isAdult: false,
  };
  await context.addInitScript((media) => {
    localStorage.setItem(
      'yoru:resume:guest',
      JSON.stringify({
        items: [
          {
            mediaId: media.id,
            mediaSnapshot: media,
            title: media.title,
            category: media.category,
            destination: 'yoru',
            number: 1,
            position: 25,
            updatedAt: Date.now(),
          },
        ],
        pending: {},
      }),
    );
    localStorage.setItem(
      'yoru:reader:state:mal-manga-21',
      JSON.stringify({
        category: 'MANGA',
        lastChapter: 'local:1',
        chapters: { 'local:1': { page: 3 } },
        updatedAt: Date.now(),
        mediaSnapshot: {
          id: 'mal-manga-21',
          title: 'Imported core progress',
          category: 'MANGA',
          isAdult: false,
        },
      }),
    );
  }, media);
  await context.route('**/api/reader/catalogs*', (route) =>
    route.fulfill({ status: 503, json: { error: 'Offline' } }),
  );
  await page.goto('/');
  await expect(page.getByText(media.title)).toBeVisible();
  await expect(page.getByText('Installed sources could not be verified.')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /installed sources/ })).toHaveCount(0);
});
