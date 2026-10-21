import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
test.beforeEach(async ({ context, baseURL }) => {
  await context.route('**/*', (route) =>
    new URL(route.request().url()).origin === baseURL ? route.continue() : route.abort(),
  );
});
test('members create public channels and guests can browse live messages without joining', async ({
  page,
  context,
  baseURL,
  browser,
}, testInfo) => {
  const name = `Book club ${randomUUID().slice(0, 8)}`;
  const account = await context.request.post('/api/auth/register', {
    headers: { Origin: baseURL },
    data: {
      name: 'Channel creator',
      email: `chat-${randomUUID()}@example.test`,
      password: 'Channel-password-123',
    },
  });
  expect(account.status()).toBe(201);
  await page.goto('/community');
  await page.getByRole('button', { name: 'Live chat', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Public live chat' })).toBeVisible();
  if (page.viewportSize().width <= 800)
    await page.getByRole('button', { name: 'Browse channels', exact: true }).click();
  await page.getByRole('button', { name: 'Create channel', exact: true }).click();
  const form = page.getByRole('form', { name: 'Create public channel' });
  await form.getByLabel('Name', { exact: true }).fill(name);
  await form.getByLabel('Description').fill('A place to share the next good read.');
  await expect(form).toContainText('Always public');
  await form.getByRole('button', { name: 'Create public channel', exact: true }).click();
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
  const channelUrl = page.url();
  await page.getByLabel('Channel message', { exact: true }).fill('Hello from the first reader.');
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect(page.getByLabel('Channel messages')).toContainText('Hello from the first reader.');
  const guestContext = await browser.newContext({ baseURL, viewport: page.viewportSize() });
  try {
    await guestContext.route('**/*', (route) =>
      new URL(route.request().url()).origin === baseURL ? route.continue() : route.abort(),
    );
    const guest = await guestContext.newPage();
    await guest.goto(channelUrl);
    await expect(guest.getByLabel('Channel messages')).toContainText(
      'Hello from the first reader.',
    );
    await expect(guest.getByRole('button', { name: 'Sign in to chat' })).toBeVisible();
    await page
      .getByLabel('Channel message', { exact: true })
      .fill('A second message, delivered live.');
    await page.getByRole('button', { name: 'Send message', exact: true }).click();
    await expect(guest.getByLabel('Channel messages')).toContainText(
      'A second message, delivered live.',
    );
    if (page.viewportSize().width <= 800)
      await guest.getByRole('button', { name: 'Browse channels', exact: true }).click();
    await guest.getByLabel('Search channels').fill(name);
    await expect(
      guest.getByRole('navigation', { name: 'Public channels' }).getByRole('button'),
    ).toHaveCount(1);
  } finally {
    await guestContext.close();
  }
  await page.reload();
  await expect(page.getByLabel('Channel messages')).toContainText('Hello from the first reader.');
  if (page.viewportSize().width <= 800)
    await page.getByRole('button', { name: 'Browse channels', exact: true }).click();
  await page.getByLabel('Search channels').fill('General');
  await page
    .getByRole('navigation', { name: 'Public channels' })
    .getByRole('button', { name: /General/ })
    .click();
  await expect(page.getByRole('heading', { name: 'General', exact: true })).toBeVisible();
  await expect(page.getByLabel('Channel messages')).not.toContainText(
    'Hello from the first reader.',
  );
  await page.goto(channelUrl);
  await expect(page.getByLabel('Channel messages')).toContainText(
    'A second message, delivered live.',
  );
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('public-channels.png'), fullPage: true });
});
