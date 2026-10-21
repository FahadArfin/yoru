import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';

test('compact space navigation switches contextual controls without losing their actions', async ({
  page,
  context,
  baseURL,
}, testInfo) => {
  await context.route('**/*', (route) =>
    new URL(route.request().url()).origin === baseURL ? route.continue() : route.abort(),
  );
  const account = await context.request.post('/api/auth/register', {
    headers: { Origin: baseURL },
    data: {
      name: 'Space reader',
      email: `space-${randomUUID()}@example.test`,
      password: 'Space-reader-password-123',
    },
  });
  expect(account.status()).toBe(201);
  const saved = await context.request.put('/api/library/mal-anime-52991', {
    headers: { Origin: baseURL },
    data: { status: 'watching', progress: 3, favorite: true },
  });
  expect(saved.ok()).toBe(true);
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/community');
  const navigation = page.getByRole('navigation', { name: 'My Space sections' });
  const header = page.locator('.space-navigation');
  await expect(header.getByRole('group', { name: 'Community view' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Discussion forums', exact: true })).toBeVisible();
  expect(await header.evaluate((el) => el.getBoundingClientRect().height)).toBeLessThan(140);
  expect(
    await page.locator('.community-page > h1').evaluate((el) => el.getBoundingClientRect().height),
  ).toBe(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  await page.screenshot({ path: testInfo.outputPath('compact-community.png') });
  await header.getByRole('button', { name: 'Live chat', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Public live chat' })).toBeVisible();
  await header.getByRole('button', { name: 'Latest activity' }).click();
  await expect(page).toHaveURL(/view=activity/);
  await page.goBack();
  await expect(header.getByRole('button', { name: 'Live chat', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await navigation.getByRole('link', { name: 'Library', exact: true }).click();
  await expect(page.getByRole('group', { name: 'Community view' })).toHaveCount(0);
  const library = header.getByRole('group', { name: 'Library view' });
  await expect(page.locator('.library-row')).toHaveCount(1);
  await library.getByRole('button', { name: 'Completed', exact: true }).click();
  await expect(page.locator('.library-row')).toHaveCount(0);
  await library.getByRole('button', { name: 'Favorites', exact: true }).click();
  await expect(page.locator('.library-row')).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Export library' })).toBeVisible();
  await navigation.getByRole('link', { name: 'Rooms', exact: true }).click();
  await expect(page.getByRole('group', { name: 'Library view' })).toHaveCount(0);
  await header.getByRole('button', { name: 'Read', exact: true }).click();
  await expect(header.getByRole('button', { name: 'Read', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page.getByRole('button', { name: 'Create a room', exact: true })).toBeVisible();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await navigation.getByRole('link', { name: 'Community', exact: true }).click();
  await expect(header.getByRole('group', { name: 'Community view' })).toBeVisible();
  await expect(header.locator('.space-subtabs')).toHaveCount(1);
  await expect
    .poll(() =>
      header.locator('.space-subtabs').evaluate((el) => getComputedStyle(el).animationName),
    )
    .toBe('none');
  expect(errors).toEqual([]);
});
