import { test, expect } from '@playwright/test';

const media = { id: 'mal-manga-2', title: 'A new chapter', category: 'MANGA', cover: '/icon.svg' };
const entries = Array.from({ length: 7 }, (_, index) => ({
  id: `comment-${index}`,
  kind: 'comment',
  mediaId: media.id,
  media,
  unit: index,
  author: { name: `Reader ${index + 1}` },
  body: index === 1 ? 'PRIVATE SPOILER TEXT' : `A thoughtful comment ${index + 1}`,
  spoiler: index === 1,
  createdAt: new Date(Date.UTC(2026, 9, 18, 12, 0, -index)).toISOString(),
}));

test.beforeEach(async ({ context, baseURL }) => {
  await context.route('**/*', (route) =>
    new URL(route.request().url()).origin === baseURL ? route.continue() : route.abort(),
  );
});

async function setup(page) {
  let items = [...entries],
    events = [],
    cursor = 0;
  await page.route('**/api/config', (route) =>
    route.fulfill({ json: { realtime: { transport: 'poll' } } }),
  );
  await page.route('**/api/poll?**', (route) => {
    const queued = events;
    events = [];
    return route.fulfill({
      json: { viewerId: null, online: { count: 0, users: [] }, cursor: ++cursor, events: queued },
    });
  });
  await page.route('**/api/community?type=comment', (route) => route.fulfill({ json: { items } }));
  return (next) => {
    items = next;
    events.push({ event: 'comments', data: { mediaId: media.id, unit: 0 } });
  };
}

test('live comments sit above the schedule, update through the shared feed, and protect readers', async ({
  page,
}, testInfo) => {
  const update = await setup(page);
  await page.goto('/');
  const section = page.getByRole('region', { name: 'Live comments', exact: true });
  await section.scrollIntoViewIfNeeded();
  await expect(section.locator('li')).toHaveCount(7);
  await expect(section.getByText('PRIVATE SPOILER TEXT')).toHaveCount(0);
  await expect(section.getByText('Spoiler discussion — open to reveal')).toBeVisible();
  await expect(section.locator('.live-comment-card').first()).toHaveAttribute(
    'href',
    '/title/mal-manga-2?unit=0',
  );
  await expect(section.locator('.live-comment-card').nth(1)).toHaveAttribute(
    'href',
    '/title/mal-manga-2?unit=1',
  );
  // Read both rectangles in one frame: loading artwork can move the page between separate calls.
  const gap = await section.evaluate((node) => {
    const schedule = document.querySelector('[aria-label="Airing schedule"]');
    return schedule.getBoundingClientRect().top - node.getBoundingClientRect().bottom;
  });
  expect(gap).toBeGreaterThanOrEqual(0);
  if (!testInfo.project.name.includes('mobile'))
    await expect
      .poll(() =>
        section
          .locator('.live-comments-mascot img')
          .evaluate((image) => image.complete && image.naturalWidth > 0),
      )
      .toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  await section.getByRole('button', { name: 'Pause automatic comment scrolling' }).click();
  const fresh = {
    ...entries[0],
    id: 'fresh',
    body: 'A brand new comment',
    createdAt: '2026-10-18T13:00:00Z',
  };
  update([fresh, ...entries]);
  await expect(section.getByRole('button', { name: '1 new' })).toBeVisible();
  await expect(section.getByText(fresh.body)).toHaveCount(0);
  await section.getByRole('button', { name: '1 new' }).click();
  await expect(section.locator('.live-comment-card').first()).toContainText(fresh.body);
  // Deletions still take effect while automatic movement is paused.
  update([...entries]);
  await expect(section.getByText(fresh.body)).toHaveCount(0);
  await section.screenshot({ path: testInfo.outputPath('live-comments.png') });
});

test('vertical comments auto-scroll and honor reduced motion', async ({ page }) => {
  await setup(page);
  await page.goto('/?category=manga');
  const section = page.getByRole('region', { name: 'Live comments', exact: true });
  await expect(section.locator('li')).toHaveCount(7);
  await section.scrollIntoViewIfNeeded();
  await expect(section).toBeInViewport();
  await page.mouse.move(0, 0);
  const viewport = section.getByLabel('Recent comments');
  await expect
    .poll(
      async () => {
        await section.scrollIntoViewIfNeeded();
        return viewport.evaluate((node) => node.scrollTop);
      },
      { timeout: 10000 },
    )
    .toBeGreaterThan(30);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(section.getByText('Auto-scroll off')).toBeVisible();
  await viewport.evaluate((node) => node.scrollTo({ top: 0, behavior: 'instant' }));
  await page.waitForTimeout(7000);
  expect(await viewport.evaluate((node) => node.scrollTop)).toBe(0);
});

test('failed refreshes retain comments and retries recover without clearing the feed', async ({
  page,
}) => {
  await setup(page);
  await page.goto('/?category=manhwa');
  const section = page.getByRole('region', { name: 'Live comments', exact: true });
  await section.scrollIntoViewIfNeeded();
  await expect(section.locator('li')).toHaveCount(7);
  await section.getByRole('button', { name: 'Pause automatic comment scrolling' }).click();
  await page.route('**/api/community?type=comment', (route) =>
    route.fulfill({ status: 503, json: { error: 'Temporary outage' } }),
  );
  // The existing connection triggers refresh; no page reload is needed.
  await page.route('**/api/poll?**', (route) =>
    route.fulfill({
      json: {
        viewerId: null,
        online: { count: 0, users: [] },
        cursor: 10,
        events: [{ event: 'comments', data: { mediaId: media.id } }],
      },
    }),
  );
  await expect(section.getByRole('status')).toContainText('showing saved comments');
  await expect(section.locator('li')).toHaveCount(7);
  await page.route('**/api/community?type=comment', (route) =>
    route.fulfill({ json: { items: [] } }),
  );
  await section.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(section.getByText('The conversation starts with you.')).toBeVisible();
  await expect(section.locator('li')).toHaveCount(0);
});
