import { test, expect } from '@playwright/test';
const id = 'mal-anime-52991';
async function setup(page, context, baseURL, outage = false) {
  await context.route('**/*', (route) =>
    new URL(route.request().url()).origin === baseURL ? route.continue() : route.abort(),
  );
  await page.route(`**/api/media/${id}`, async (route) => {
    const body = await (await route.fetch()).json();
    Object.assign(body.media || body, { status: 'Currently Airing', episodes: 13 });
    await route.fulfill({ json: body });
  });
  await page.route(`**/api/media/${id}/episodes?*`, (route) =>
    route.fulfill({
      json: {
        mediaId: id,
        page: 1,
        pages: 1,
        total: 13,
        latest: outage ? null : 2,
        partial: outage,
        items: outage
          ? []
          : [1, 2].map((number) => ({
              number,
              title: `Aired episode ${number}`,
              aired: '2020-01-01T00:00:00Z',
            })),
      },
    }),
  );
  await page.route('**/api/home?*', (route) =>
    route.fulfill({
      json: {
        state: outage ? 'unavailable' : 'ready',
        stale: outage,
        releases: outage
          ? []
          : [
              {
                media: { id },
                episode: 3,
                airingAt: new Date(Date.now() - 60000).toISOString(),
                airType: 'sub',
              },
            ],
      },
    }),
  );
}
test('unreleased episodes are dimmed across episode lists and cannot open a player', async ({
  page,
  context,
  baseURL,
}, testInfo) => {
  await setup(page, context, baseURL);
  const sourceRequests = [];
  page.on('request', (request) => {
    if (request.url().includes(`/api/media/${id}/sources?`))
      sourceRequests.push(new URL(request.url()).searchParams.get('episode'));
  });
  await page.goto(`/watch/${id}/3`);
  const panel = page.getByRole('complementary', { name: 'Episode browser' });
  await expect(
    panel.getByRole('button', { name: 'Episode 3, now playing', exact: true }),
  ).toBeEnabled();
  const future = panel.getByRole('button', { name: 'Episode 4, unreleased', exact: true });
  await expect(future).toBeDisabled();
  await expect(future).toContainText('Soon');
  await expect(future).toHaveCSS('opacity', '0.4');
  await expect(page.getByRole('button', { name: 'Next', exact: true })).toBeDisabled();
  await panel.getByRole('spinbutton', { name: 'Go to episode', exact: true }).fill('4');
  await panel.getByRole('button', { name: 'Go', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/watch/${id}/3$`));
  await panel.getByRole('button', { name: 'Episode list', exact: true }).click();
  await expect(future).toContainText('Unreleased');
  await expect(future).not.toContainText('SUB');
  await page.goto(`/watch/${id}/4`);
  await expect(
    page.getByRole('heading', { name: 'Episode 4 hasn’t been released yet' }),
  ).toBeVisible();
  await expect(page.locator('iframe,video')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Mark complete', exact: true })).toBeDisabled();
  expect(sourceRequests).not.toContain('4');
  await panel.screenshot({ path: testInfo.outputPath('unreleased-list.png') });
  await page.goto(`/title/${id}`);
  const guide = page.getByRole('region', { name: 'Episode guide' });
  await expect(guide.getByRole('link', { name: /Watch episode 3:/ })).toBeVisible();
  await expect(guide.getByRole('link', { name: /Watch episode 4:/ })).toHaveCount(0);
  await guide.getByRole('button', { name: 'Episodes 1–13', exact: true }).click();
  await expect(
    guide.getByRole('button', { name: 'Episode 4, not aired yet', exact: true }),
  ).toBeDisabled();
  await expect(guide.getByRole('link', { name: 'Episode 3', exact: true })).toBeEnabled();
});
test('metadata outages do not label unknown episodes as unreleased', async ({
  page,
  context,
  baseURL,
}) => {
  await setup(page, context, baseURL, true);
  await page.goto(`/watch/${id}/4`);
  const panel = page.getByRole('complementary', { name: 'Episode browser' });
  await expect(
    panel.getByRole('button', { name: 'Episode 4, now playing', exact: true }),
  ).toBeEnabled();
  await expect(panel.locator('.is-unreleased')).toHaveCount(0);
  await expect(page.locator('iframe')).toBeVisible();
});
