import { test, expect } from '@playwright/test';
const id = 'mal-anime-52991';
test.beforeEach(async ({ context, baseURL }) => {
  await context.route('**/*', (route) =>
    new URL(route.request().url()).origin === baseURL ? route.continue() : route.abort(),
  );
});

test('release and trending cards open episodes, with series details below the player', async ({
  page,
}) => {
  await page.route('**/api/home?**', (route) =>
    route.fulfill({
      json: {
        state: 'ready',
        language: 'all',
        hot: [],
        releases: [
          {
            id: 'recent',
            title: 'Released anime',
            airType: 'dub',
            episode: 7,
            airingAt: new Date().toISOString(),
            media: { id },
            cover: '/icon.svg',
          },
        ],
      },
    }),
  );
  await page.route('**/api/home/discovery?**', (route) => {
    const p = new URL(route.request().url()).searchParams;
    return route.fulfill({
      json: {
        mode: p.get('mode'),
        period: p.get('period'),
        state: 'ready',
        items: [{ id, title: 'Trending anime', viewers: 4, cover: '/icon.svg' }],
      },
    });
  });
  await page.route(`**/api/media/${id}/episodes?latest=1`, (route) =>
    route.fulfill({ json: { mediaId: id, latest: 26 } }),
  );
  await page.goto('/?category=anime');
  await page
    .getByRole('region', { name: 'Just released', exact: true })
    .getByRole('link', { name: /Released anime/ })
    .click();
  await expect(page).toHaveURL(/\/7\?language=dub$/);
  const player = page.locator('.embed-player');
  const details = page.getByRole('region', { name: 'About this anime' });
  await expect(details).toContainText('Frieren');
  expect((await details.boundingBox()).y).toBeGreaterThan(
    (await player.boundingBox()).y + (await player.boundingBox()).height,
  );
  await page.goto('/?category=anime');
  const trend = page.getByRole('region', { name: 'Trending', exact: true });
  await expect(trend.getByRole('link', { name: /Trending anime/ })).toHaveAttribute(
    'href',
    `/watch/${id}/latest`,
  );
  await trend.getByRole('link', { name: /Trending anime/ }).click();
  await expect(page).toHaveURL(new RegExp(`/watch/${id}/26$`));
  await expect(page.locator('iframe')).toHaveAttribute('src', /\/26\/sub$/);
});

test('title overview has an episode grid with real metadata, ranges and number jumps for long series', async ({
  page,
}) => {
  await page.route(`**/api/media/${id}`, async (route) => {
    const body = await (await route.fetch()).json();
    (body.media || body).episodes = 1200;
    await route.fulfill({ json: body });
  });
  const requests = [];
  await page.route(`**/api/media/${id}/episodes?page=*`, (route) => {
    const p = Number(new URL(route.request().url()).searchParams.get('page'));
    requests.push(p);
    return route.fulfill({
      json: {
        mediaId: id,
        page: p,
        pages: 12,
        total: 1200,
        partial: false,
        source: 'MyAnimeList via Tenrai',
        items: Array.from({ length: 100 }, (_, i) => ({
          number: (p - 1) * 100 + i + 1,
          title: `Chapter of the journey ${(p - 1) * 100 + i + 1}`,
          image: '/icon.svg',
          aired: '2020-01-01T00:00:00Z',
        })),
      },
    });
  });
  await page.goto(`/title/${id}`);
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Frieren');
  await expect(page.locator('iframe')).toHaveCount(0);
  const guide = page.getByRole('region', { name: 'Episode guide' });
  await expect(guide.getByRole('link', { name: /Watch episode/ })).toHaveCount(50);
  const trigger = guide.getByRole('button', { name: 'Episodes 1–50', exact: true });
  await trigger.click();
  const picker = guide.getByRole('dialog', { name: 'Choose an episode' });
  await expect(picker).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect(picker.getByRole('link', { name: /^Episode \d+$/ })).toHaveCount(50);
  await picker.getByRole('spinbutton', { name: 'Jump to episode' }).press('Escape');
  await expect(picker).not.toBeVisible();
  await expect(trigger).toBeFocused();
  await trigger.click();
  await guide.getByRole('combobox', { name: 'Episode range' }).selectOption('21');
  await expect(picker.getByRole('link', { name: 'Episode 1051', exact: true })).toHaveAttribute(
    'href',
    `/watch/${id}/1051`,
  );
  await picker.getByRole('button', { name: 'Close episode picker' }).click();
  await expect(
    guide.getByRole('link', {
      name: 'Watch episode 1051: Chapter of the journey 1051',
      exact: true,
    }),
  ).toBeVisible();
  await guide.getByRole('spinbutton', { name: 'Find episode number' }).fill('1187');
  await guide.getByRole('button', { name: 'Find', exact: true }).click();
  const target = guide.getByRole('link', {
    name: 'Watch episode 1187: Chapter of the journey 1187',
    exact: true,
  });
  await expect(target).toHaveClass(/is-highlighted/);
  await guide.getByRole('button', { name: 'Episodes 1151–1200', exact: true }).click();
  await picker.getByRole('spinbutton', { name: 'Jump to episode' }).fill('1187');
  await picker.getByRole('button', { name: 'Go', exact: true }).click();
  await expect(picker.getByRole('link', { name: 'Episode 1187', exact: true })).toBeFocused();
  await picker.getByRole('link', { name: 'Episode 1187', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/watch/${id}/1187$`));
  expect(requests).toEqual([1, 11, 12]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('future episodes stay unavailable and latest lookup failure never starts episode one silently', async ({
  page,
}) => {
  await page.route(`**/api/media/${id}/episodes?*`, (route) =>
    route.fulfill({
      json: {
        mediaId: id,
        page: 1,
        pages: 1,
        total: 28,
        latest: null,
        items: [{ number: 28, title: 'Coming soon', aired: '2099-01-01T00:00:00Z' }],
      },
    }),
  );
  await page.goto(`/title/${id}`);
  const guide = page.getByRole('region', { name: 'Episode guide' });
  await expect(guide.getByText('Coming soon')).toBeVisible();
  await expect(guide.getByRole('link', { name: /Watch episode 28/ })).toHaveCount(0);
  await guide.getByRole('button', { name: 'Episodes 1–28', exact: true }).click();
  await expect(
    guide
      .getByRole('dialog')
      .getByRole('button', { name: 'Episode 28, not aired yet', exact: true }),
  ).toBeDisabled();
  await guide.getByRole('heading', { name: 'Episodes', exact: true }).click();
  await expect(guide.getByRole('dialog')).not.toBeVisible();
  await page.goto(`/watch/${id}/latest`);
  await expect(page.getByRole('heading', { name: 'Choose your episode.' })).toBeVisible();
  await expect(page.locator('iframe')).toHaveCount(0);
  await page.getByRole('link', { name: 'Browse episodes', exact: true }).click();
  await expect(page).toHaveURL(/tab=episodes/);
});
