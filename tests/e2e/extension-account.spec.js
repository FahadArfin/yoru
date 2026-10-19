import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { accountSource, accountClassification } from '../extension-account-contract.mjs';
import { assertMediaEligible } from '../../shared/reading-eligibility.js';

// This checks account-view wiring using fixture progress. Actual native reader
// acquisition, chapter opening and page saving belong to the Tasks 10–12 journey.
test('fresh login scopes fixture native history through disable, reload and Ara confirmation', async ({
  browser,
  baseURL,
}) => {
  const first = await browser.newContext({ baseURL }),
    second = await browser.newContext({ baseURL });
  const credentials = {
    name: 'Native history reader',
    email: `${randomUUID()}@example.test`,
    password: 'Native account history 2026',
  };
  const safe = {
    id: 'ext-manga-' + 'a'.repeat(32),
    title: 'Native safe saved edition',
    category: 'MANGA',
    isAdult: false,
    sourceRef: accountSource(),
    classification: accountClassification(),
    cover: '/icon.svg',
    malId: null,
    idMal: null,
  };
  const adult = {
    id: 'ext-manga-' + 'b'.repeat(32),
    title: 'Ara private saved edition',
    category: 'MANGA',
    isAdult: true,
    sourceRef: accountSource('456', 'adult', 'NHentai.to'),
    classification: accountClassification('adult'),
    cover: '/icon.svg',
    malId: null,
    idMal: null,
  };
  const setup = async (context) => {
    await context.route('**/api/reader/catalogs*', (route) =>
      route.fulfill({
        json: {
          sources: [safe.sourceRef, adult.sourceRef].map((s) => ({ ...s, name: s.providerKey })),
          nextCursor: null,
          complete: true,
        },
      }),
    );
    await context.route('**/api/ara-ara/catalog', (route) =>
      route.fulfill({ json: { items: [], total: 0 } }),
    );
    const accountView = async (route) => {
      const url = new URL(route.request().url()),
        destination = url.searchParams.get('destination') || 'yoru';
      const preferences = await (await context.request.get('/api/reader/preferences')).json();
      const media = [safe, adult].filter((m) => {
        try {
          assertMediaEligible(m, {
            destination,
            extensionsEnabled: true,
            overrides: preferences.overrides,
          });
          return true;
        } catch {
          return false;
        }
      });
      const resume = url.pathname === '/api/resume';
      return route.fulfill({
        json: {
          items: media.map((m) =>
            resume
              ? {
                  mediaId: m.id,
                  title: m.title,
                  cover: m.cover,
                  category: m.category,
                  number: 3,
                  chapterId: '',
                  page: 8,
                  updatedAt: Date.now(),
                  destination,
                  sourceRef: m.sourceRef,
                  classification: m.classification,
                }
              : {
                  mediaId: m.id,
                  media: m,
                  status: 'reading',
                  progress: 3,
                  favorite: false,
                  updatedAt: new Date().toISOString(),
                },
          ),
        },
      });
    };
    await context.route(/\/api\/(?:library|resume)(?:\?|$)/, accountView);
  };
  try {
    expect(
      (
        await first.request.post('/api/auth/register', {
          headers: { Origin: baseURL },
          data: credentials,
        })
      ).status(),
    ).toBe(201);
    await setup(second);
    expect(
      (
        await second.request.post('/api/auth/login', {
          headers: { Origin: baseURL },
          data: credentials,
        })
      ).ok(),
    ).toBeTruthy();
    const page = await second.newPage();
    await page.goto('/');
    const rail = page.getByRole('region', { name: 'Pick up where you left off' });
    await expect(rail).toContainText(safe.title);
    await expect(rail).toContainText('Page 8');
    await expect(page.getByText(adult.title)).toHaveCount(0);
    await page.reload();
    await expect(rail).toContainText(safe.title);
    await page.goto('/settings');
    const toggle = page.getByRole('switch', { name: 'MangaDex in Yoru' });
    await expect(toggle).toBeVisible();
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-checked', 'false');
    await page.goto('/');
    await expect(page.getByText(safe.title)).toHaveCount(0);
    await page.goto('/settings');
    await page.getByRole('switch', { name: 'MangaDex in Yoru' }).click();
    await page.goto('/');
    await expect(rail).toContainText(safe.title);
    let beforeConfirmation = 0;
    page.on('request', (request) => {
      const url = new URL(request.url());
      if (
        ['/api/library', '/api/resume'].includes(url.pathname) &&
        url.searchParams.get('destination') === 'ara-ara'
      )
        beforeConfirmation++;
    });
    await page.goto('/ara-ara');
    await expect(page.getByRole('heading', { name: 'Adults only' })).toBeVisible();
    await expect(page.getByText(adult.title)).toHaveCount(0);
    expect(beforeConfirmation).toBe(0);
    await page.getByRole('button', { name: /I’m 18 or older/ }).click();
    await expect(rail).toContainText(adult.title);
    await expect(rail).not.toContainText(safe.title);
    await page.goto('/');
    await expect(rail).toContainText(safe.title);
    await expect(page.getByText(adult.title)).toHaveCount(0);
  } finally {
    await first.close();
    await second.close();
  }
});
