import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';

test.beforeEach(async ({ context, baseURL }) => {
  await context.route('**/*', (route) =>
    new URL(route.request().url()).origin === baseURL ? route.continue() : route.abort(),
  );
});
test('email members can edit their public name and see what syncs', async ({
  page,
  context,
  baseURL,
}, info) => {
  await context.request.post('/api/auth/register', {
    headers: { Origin: baseURL },
    data: {
      name: 'Account reader',
      email: `${randomUUID()}@example.test`,
      password: 'Account testing password',
    },
  });
  await page.goto('/settings');
  await page.getByLabel('Public display name').fill('My saved name');
  await page.getByRole('button', { name: 'Save display name' }).click();
  await expect
    .poll(async () => (await (await context.request.get('/api/auth/me')).json()).user.name)
    .toBe('My saved name');
  await page.reload();
  await expect(page.getByLabel('Public display name')).toHaveValue('My saved name');
  await page.getByText('What saves to my account?', { exact: true }).click();
  await expect(page.locator('.account-connections')).toContainText(
    'chapter bookmarks and read markers',
  );
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  await page.screenshot({ path: info.outputPath('account-settings.png'), fullPage: true });
});

test('Sites ChatGPT button completes platform navigation and returns to the same account on another browser', async ({
  page,
  context,
  browser,
  baseURL,
}, info) => {
  test.skip(
    !(await (await context.request.get('/api/config')).json()).auth.chatgpt,
    'ChatGPT identity is available only on Sites',
  );
  const subject = randomUUID(),
    email = `${subject}@example.test`;
  // Simulate the Sites gateway only in the disposable test browser; production has no test auth route.
  const gateway = async (ctx) => {
    const navigate = (route, target) =>
      route.fulfill({
        contentType: 'text/html',
        body: `<script>location.href=${JSON.stringify(target)}</script>`,
      });
    // Start a fresh document navigation at each simulated gateway hop so Playwright
    // can add gateway headers; redirected subrequests bypass route interception.
    await ctx.route('**/api/auth/chatgpt/start?*', async (route) => {
      const response = await route.fetch({ maxRedirects: 0 });
      return route.fulfill({
        response,
        status: 200,
        headers: { ...response.headers(), 'content-type': 'text/html' },
        body: `<script>location.href=${JSON.stringify(response.headers().location)}</script>`,
      });
    });
    await ctx.route('**/signin-with-chatgpt?*', (route) =>
      navigate(route, new URL(route.request().url()).searchParams.get('return_to')),
    );
    await ctx.route('**/api/auth/chatgpt/complete?*', (route) =>
      route.continue({
        headers: {
          ...route.request().headers(),
          'oai-authenticated-user-id': subject,
          'oai-authenticated-user-email': email,
        },
      }),
    );
    await ctx.route('**/signout-with-chatgpt?*', (route) =>
      route.fulfill({ status: 302, headers: { Location: '/' }, body: '' }),
    );
  };
  await gateway(context);
  await page.goto('/community?view=chat');
  await page.getByRole('button', { name: 'Sign in', exact: true }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Sign in to Yoru' });
  await expect(dialog.getByRole('link', { name: 'Continue with ChatGPT' })).toHaveAttribute(
    'target',
    '_top',
  );
  await expect(dialog.getByLabel('Email', { exact: true })).toBeVisible();
  await dialog.screenshot({ path: info.outputPath('chatgpt-signin.png') });
  await dialog.getByRole('link', { name: 'Continue with ChatGPT' }).click();
  await expect(page).toHaveURL(/\/community\?view=chat$/);
  const user = (await (await context.request.get('/api/auth/me')).json()).user;
  expect(user.chatgptConnected).toBe(true);
  await page.goto('/settings');
  await page.getByLabel('Public display name').fill('ChatGPT member');
  await page.getByRole('button', { name: 'Save display name' }).click();
  await expect
    .poll(async () => (await (await context.request.get('/api/auth/me')).json()).user.name)
    .toBe('ChatGPT member');
  const other = await browser.newContext({ baseURL });
  try {
    await other.route('**/*', (route) =>
      new URL(route.request().url()).origin === baseURL ? route.continue() : route.abort(),
    );
    await gateway(other);
    const second = await other.newPage();
    await second.goto('/settings');
    await second.getByRole('link', { name: 'Continue with ChatGPT' }).click();
    await expect(second.getByLabel('Public display name')).toHaveValue('ChatGPT member');
    expect((await (await other.request.get('/api/auth/me')).json()).user.id).toBe(user.id);
    await second.getByRole('button', { name: 'Sign out', exact: true }).click();
    await expect(second).toHaveURL(baseURL + '/');
    expect((await (await other.request.get('/api/auth/me')).json()).user).toBeNull();
  } finally {
    await other.close();
  }
});
