import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
const id = 'mal-anime-52991';
const gif = 'https://media.giphy.com/media/example/giphy.gif';
const pixel = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6HAAAAABJRU5ErkJggg==',
  'base64',
);
test.beforeEach(async ({ context, baseURL }) => {
  await context.route('**/*', (route) =>
    new URL(route.request().url()).origin === baseURL ? route.continue() : route.abort(),
  );
});
async function signIn(page, baseURL) {
  const name = `Commenter ${randomUUID().slice(0, 8)}`;
  const response = await page.request.post('/api/auth/register', {
    headers: { Origin: baseURL },
    data: { name, email: `${randomUUID()}@example.test`, password: 'Yoru comment test 2026' },
  });
  expect(response.status()).toBe(201);
  return name;
}
test('signed-in episode comments support emoji, FFZ, GIF-only replies, spoilers and reversible reactions', async ({
  page,
  baseURL,
}) => {
  const name = await signIn(page, baseURL);
  await page.route('https://api.frankerfacez.com/v1/set/global', (route) =>
    route.fulfill({
      json: { default_sets: [3], sets: { 3: { emoticons: [{ id: 9, name: 'ZrehplaR' }] } } },
    }),
  );
  await page.route('https://cdn.frankerfacez.com/**', (route) =>
    route.fulfill({ contentType: 'image/png', body: pixel }),
  );
  await page.route('https://media.giphy.com/**', (route) =>
    route.fulfill({ contentType: 'image/png', body: pixel }),
  );
  await page.goto(`/title/${id}?unit=71`);
  const composer = page.locator('.comment-compose');
  await composer.getByLabel('Discussion comment', { exact: true }).fill('What a scene! ');
  await composer.getByRole('button', { name: 'Add Emoji', exact: true }).click();
  await composer.getByRole('button', { name: 'Insert 😂', exact: true }).click();
  await composer.getByRole('button', { name: 'Add Emotes', exact: true }).click();
  await composer.getByLabel('Search FrankerFaceZ emotes').fill('Zreh');
  await composer.getByRole('button', { name: 'Insert ZrehplaR', exact: true }).click();
  await composer.getByRole('button', { name: 'Post comment', exact: true }).click();
  const thread = page.locator('.comment-list > .comment').filter({ hasText: name }).first();
  await expect(thread.getByRole('img', { name: 'ZrehplaR', exact: true })).toBeVisible();
  await expect(thread).toContainText('😂');
  const like = thread.getByRole('button', { name: `Like comment by ${name}`, exact: true });
  await like.click();
  await expect(like).toHaveAttribute('aria-pressed', 'true');
  await expect(like).toHaveText('1');
  const dislike = thread.getByRole('button', { name: 'Dislike comment', exact: true });
  await dislike.click();
  await expect(dislike).toHaveAttribute('aria-pressed', 'true');
  await expect(like).toHaveText('0');
  await dislike.click();
  await expect(dislike).toHaveText('0');
  await thread.getByRole('button', { name: 'Reply', exact: true }).click();
  await composer.getByRole('button', { name: 'Add GIF', exact: true }).click();
  await composer.getByLabel('GIF image URL').fill('https://evil.test/image.gif');
  await expect(composer.getByRole('button', { name: 'Attach GIF', exact: true })).toBeDisabled();
  await composer.getByLabel('GIF image URL').fill(gif);
  await composer.getByRole('button', { name: 'Attach GIF', exact: true }).click();
  await composer.getByLabel('Contains spoilers', { exact: true }).check();
  await composer.getByRole('button', { name: 'Post reply', exact: true }).click();
  await expect(thread.getByRole('img', { name: 'Comment GIF' })).toBeHidden();
  await thread.getByRole('button', { name: 'Spoiler · click to reveal' }).click();
  await expect(thread.getByRole('img', { name: 'Comment GIF' })).toBeVisible();
  await composer.getByLabel('Discussion comment', { exact: true }).fill('Unposted draft');
  await page.getByLabel('Discussion episode', { exact: true }).fill('72');
  await expect(composer.getByLabel('Discussion comment', { exact: true })).toHaveValue('');
  await expect(page.locator('.comment-list')).toBeHidden();
  await page.getByLabel('Discussion episode', { exact: true }).fill('71');
  await page.reload();
  await expect(thread.getByRole('img', { name: 'ZrehplaR', exact: true })).toBeVisible();
  await expect(thread.getByRole('img', { name: 'Comment GIF' })).toBeHidden();
  const data = await (await page.request.get(`/api/comments/${id}?unit=71`)).json();
  const own = data.items.filter((item) => item.author.name === name);
  expect(own.some((item) => item.parentId && item.body === `![GIF](${gif})`)).toBe(true);
});
test('media input Enter never submits early and an open picker cannot change a pending post', async ({
  page,
  baseURL,
}) => {
  await signIn(page, baseURL);
  await page.route('https://media.giphy.com/**', (route) =>
    route.fulfill({ contentType: 'image/png', body: pixel }),
  );
  await page.goto(`/title/${id}?unit=75`);
  const composer = page.locator('.comment-compose');
  const body = `Draft ${randomUUID()}`;
  await composer.getByLabel('Discussion comment', { exact: true }).fill(body);
  let posts = 0,
    release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  await page.route(`**/api/comments/${id}`, async (route) => {
    if (route.request().method() === 'POST') {
      posts++;
      await gate;
    }
    await route.continue();
  });
  await composer.getByRole('button', { name: 'Add GIF', exact: true }).click();
  await composer.getByLabel('GIF image URL').fill(gif);
  await composer.getByLabel('GIF image URL').press('Enter');
  await expect(composer.getByRole('button', { name: 'Attach GIF', exact: true })).toBeVisible();
  expect(posts).toBe(0);
  await composer.getByRole('button', { name: 'Attach GIF', exact: true }).click();
  await composer.getByRole('button', { name: 'Add Emoji', exact: true }).click();
  await composer.getByRole('button', { name: 'Post comment', exact: true }).click();
  try {
    await expect.poll(() => posts).toBe(1);
    await expect(composer.getByRole('region', { name: 'Emoji picker' })).toBeHidden();
    await expect(composer.getByRole('button', { name: 'Add Emoji', exact: true })).toBeDisabled();
    await expect(composer.getByRole('button', { name: 'Remove GIF', exact: true })).toBeDisabled();
  } finally {
    release();
  }
  await expect(page.locator('.comment-list')).toContainText(body);
});

test('guests are prompted to sign in and FFZ failure does not block ordinary comments', async ({
  page,
  baseURL,
}) => {
  await page.goto(`/title/${id}?unit=73`);
  await expect(page.getByLabel('Discussion comment', { exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Sign in to comment', exact: true })).toBeVisible();
  await signIn(page, baseURL);
  await page.reload();
  await page.route('https://api.frankerfacez.com/v1/set/global', (route) =>
    route.fulfill({ status: 503, body: '' }),
  );
  await page.getByRole('button', { name: 'Add Emotes', exact: true }).click();
  await expect(page.getByText('FrankerFaceZ emotes are temporarily unavailable.')).toBeVisible();
  await page.getByLabel('Discussion comment', { exact: true }).fill(`Still here ${randomUUID()}`);
  await page.getByRole('button', { name: 'Post comment', exact: true }).click();
  await expect(page.getByLabel('Discussion comment', { exact: true })).toHaveValue('');
});
