import { test, expect } from '@playwright/test';
const id = 'mal-anime-52991';
test.beforeEach(async ({ context, baseURL }) => {
  await context.route('**/*', (route) =>
    new URL(route.request().url()).origin === baseURL ? route.continue() : route.abort(),
  );
});
test('cast pairs characters with the selected voice language and expands on title and player pages', async ({
  page,
}) => {
  const items = Array.from({ length: 14 }, (_, i) => ({
    id: i + 1,
    name: `Character ${i + 1}`,
    role: i < 2 ? 'Main' : 'Supporting',
    image: '/icon.svg',
    actors: [
      { id: 100 + i, name: `Japanese Actor ${i + 1}`, language: 'Japanese', image: '/icon.svg' },
      ...(i === 0
        ? []
        : [
            {
              id: 200 + i,
              name: `English Actor ${i + 1}`,
              language: 'English',
              image: '/icon.svg',
            },
          ]),
    ],
  }));
  await page.route(`**/api/media/${id}/cast`, (route) => route.fulfill({ json: { items } }));
  await page.goto(`/title/${id}`);
  const cast = page.getByRole('region', { name: 'Character Cast', exact: true });
  await expect(cast.locator('article')).toHaveCount(12);
  await expect(cast).toContainText('Japanese Actor 1');
  await cast.getByLabel('Voice actor language').selectOption('English');
  await expect(cast).toContainText('English Actor 2');
  await expect(cast).toContainText('Voice actor unlisted');
  await expect(cast).not.toContainText('Japanese Actor');
  await cast.getByRole('button', { name: 'View more (2)' }).click();
  await expect(cast.locator('article')).toHaveCount(14);
  await cast.getByRole('button', { name: 'Show less' }).click();
  await expect(cast.locator('article')).toHaveCount(12);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  ).toBeTruthy();
  await page.goto(`/watch/${id}/1`);
  await expect(cast).toContainText('Japanese Actor 1');
});
test('cast distinguishes empty data from a temporary outage and retries', async ({ page }) => {
  let attempt = 0;
  await page.route(`**/api/media/${id}/cast`, (route) =>
    route.fulfill({
      json: ++attempt === 1 ? { items: [], partial: true } : { items: [], partial: false },
    }),
  );
  await page.goto(`/title/${id}`);
  const cast = page.getByRole('region', { name: 'Character Cast', exact: true });
  await expect(cast).toContainText('temporarily unavailable');
  await cast.getByRole('button', { name: 'Retry' }).click();
  await expect(cast).toContainText('haven’t been announced');
});
