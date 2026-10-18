import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';

const id = 'mal-anime-52991';
test.beforeEach(async ({ context, baseURL }) => {
  await context.route('**/*', (route) =>
    new URL(route.request().url()).origin === baseURL ? route.continue() : route.abort(),
  );
});

test('watch layout offers saved tiles/list, groups, episode navigation and theater without reloading the player', async ({
  page,
  isMobile,
}) => {
  await page.route(`**/api/media/${id}`, async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    (body.media || body).episodes = 123;
    await route.fulfill({ json: body });
  });
  await page.goto(`/watch/${id}/51?language=dub`);
  const panel = page.getByRole('complementary', { name: 'Episode browser' });
  await expect(
    panel.getByRole('button', { name: 'Episode 51, now playing', exact: true }),
  ).toHaveAttribute('aria-current', 'true');
  await expect(panel.locator('.episode-tiles > button')).toHaveCount(50);
  await panel.getByRole('button', { name: 'Next episode group' }).click();
  await expect(panel.locator('.episode-tiles > button')).toHaveCount(23);
  await panel.getByRole('button', { name: 'Episode 123', exact: true }).click();
  await expect(page).toHaveURL(/123\?language=dub/);
  await expect(page.getByRole('button', { name: 'Next', exact: true })).toBeDisabled();
  await panel.getByRole('button', { name: 'Episode list', exact: true }).click();
  await expect(panel.locator('.episode-list > button')).toHaveCount(23);
  await page.reload();
  await expect(panel.getByRole('button', { name: 'Episode list', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(
    panel.getByRole('button', { name: 'Episode 123, now playing', exact: true }),
  ).toContainText('Now playing');
  await page.locator('iframe').evaluate((frame) => (frame.dataset.playerIdentity = 'retained'));
  const width = (await page.locator('.embed-player').boundingBox()).width;
  if (!isMobile) expect(width).toBeGreaterThan(page.viewportSize().width * 0.68);
  await page.getByRole('button', { name: 'Theater', exact: true }).click();
  await expect(page.locator('.watch-cinema')).toHaveClass(/is-theater/);
  await expect(page.locator('iframe')).toHaveAttribute('data-player-identity', 'retained');
  if (!isMobile)
    expect((await page.locator('.embed-player').boundingBox()).width).toBeGreaterThan(width + 200);
  await page.getByRole('button', { name: 'Theater', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Autoplay', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Auto next', exact: true })).toBeDisabled();
  await expect(
    page.getByText('This provider manages playback. Use the controls inside its player.'),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Previous', exact: true }).click();
  await expect(page).toHaveURL(/122\?language=dub/);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('native episode sources honor auto next boundaries and autoplay does not reload the video', async ({
  page,
}) => {
  await page.route(`**/api/media/${id}/sources?*`, (route) => {
    const params = new URL(route.request().url()).searchParams;
    const episode = Number(params.get('episode'));
    return route.fulfill({
      json: {
        mediaId: id,
        episode,
        language: params.get('language'),
        items: [
          {
            id: 'test-video',
            label: 'Episode video',
            kind: 'video',
            url: `https://video.example.test/${episode}.mp4`,
          },
        ],
      },
    });
  });
  await page.goto(`/watch/${id}/27?source=test-video`);
  await expect(page.locator('video')).toBeVisible();
  await page.locator('video').evaluate((video) => {
    window.watchLoadCount = 0;
    video.load = () => window.watchLoadCount++;
  });
  await page.getByRole('button', { name: 'Autoplay', exact: true }).click();
  expect(await page.evaluate(() => window.watchLoadCount)).toBe(0);
  await expect(page.locator('video')).toHaveAttribute('autoplay', '');
  await page.getByRole('button', { name: 'Auto next', exact: true }).click();
  await page.locator('video').evaluate((video) => video.dispatchEvent(new Event('ended')));
  await expect(page).toHaveURL(/\/28\?source=test-video/);
  await expect(page.locator('video')).toHaveAttribute('src', 'https://video.example.test/28.mp4');
  await page.locator('video').evaluate((video) => video.dispatchEvent(new Event('ended')));
  await expect(page).toHaveURL(/\/28\?source=test-video/);
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('a custom title-wide URL cannot loop itself as the next episode and bookmarks persist in the library', async ({
  page,
  baseURL,
}) => {
  const response = await page.request.post('/api/auth/register', {
    headers: { Origin: baseURL },
    data: {
      name: 'Watch tester',
      email: `watch-${randomUUID()}@example.test`,
      password: 'Watch testing password 2026',
    },
  });
  expect(response.status()).toBe(201);
  await page.addInitScript(
    (id) =>
      localStorage.setItem(
        `yoru:source:${id}`,
        JSON.stringify({ kind: 'video', url: 'https://video.example.test/custom.mp4' }),
      ),
    id,
  );
  await page.goto(`/watch/${id}/1`);
  await expect(page.getByRole('button', { name: 'Auto next', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Autoplay', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Bookmark', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Bookmarked', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.reload();
  await expect(page.getByRole('button', { name: 'Bookmarked', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.getByRole('button', { name: 'Bookmarked', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Bookmark', exact: true })).toHaveAttribute(
    'aria-pressed',
    'false',
  );
});
