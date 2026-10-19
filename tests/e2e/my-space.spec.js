import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { readerImage } from '../fixtures/reader-image.mjs';

const anime = 'mal-anime-52991';
const manhwa = 'mal-manga-121496';
test.beforeEach(async ({ context, baseURL }) => {
  await context.route('**/*', (route) =>
    new URL(route.request().url()).origin === baseURL ? route.continue() : route.abort(),
  );
});
async function register(page, baseURL) {
  const result = await page.request.post('/api/auth/register', {
    headers: { Origin: baseURL },
    data: {
      name: 'Room host',
      email: `${randomUUID()}@example.test`,
      password: 'Yoru testing password 2026',
    },
  });
  expect(result.status()).toBe(201);
}

test('My Space unifies navigation while preserving library, community and public room links', async ({
  page,
  isMobile,
}) => {
  await page.goto('/community');
  const sections = page.getByRole('navigation', { name: 'My Space sections' });
  await expect(page.getByRole('heading', { name: 'My Space', exact: true })).toBeVisible();
  if (!isMobile) {
    const top = page.getByRole('navigation', { name: 'Explore Yoru' });
    await expect(top.getByRole('link', { name: 'My Space', exact: true })).toBeVisible();
    await expect(top.getByRole('link', { name: 'Watch & read', exact: true })).toHaveCount(0);
    await expect(top.getByRole('link', { name: 'My library', exact: true })).toHaveCount(0);
  }
  await sections.getByRole('link', { name: 'Library', exact: true }).click();
  await expect(page).toHaveURL(/\/library$/);
  await expect(sections.getByRole('link', { name: 'Library', exact: true })).toHaveAttribute(
    'aria-current',
    'page',
  );
  await sections.getByRole('link', { name: 'Rooms', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Create a room', exact: true })).toBeVisible();
});

test('watch together creates a private invitation for the selected episode and dub source', async ({
  page,
  baseURL,
}) => {
  await register(page, baseURL);
  await page.goto(`/watch/${anime}/7?language=dub`);
  await page.getByRole('button', { name: 'Watch together', exact: true }).click();
  const modal = page.getByRole('dialog');
  await expect(modal.getByLabel('Starting unit')).toHaveValue('7');
  await expect(modal.getByLabel('Who can join?')).toHaveValue('private');
  await modal.getByRole('button', { name: 'Create room', exact: true }).click();
  const invite = modal.getByLabel('Room invitation');
  await expect(invite).toHaveValue(/\/rooms\/[^?]+\?invite=.+/);
  const invitation = await invite.inputValue();
  await modal.getByRole('link', { name: 'Enter room', exact: true }).click();
  await expect(page.getByTestId('room-unit')).toHaveText('7');
  await expect(page.locator('.room-stage iframe')).toHaveAttribute(
    'src',
    'https://megaplay.buzz/stream/mal/52991/7/dub',
  );
  await expect(page.locator('.room-sync-bar')).toContainText('provider playback is independent');
  await page.getByLabel('Room unit', { exact: true }).fill('8');
  await page.getByRole('button', { name: 'Go', exact: true }).click();
  await expect(page.locator('.room-stage iframe')).toHaveAttribute(
    'src',
    'https://megaplay.buzz/stream/mal/52991/8/dub',
  );
  await page.goto('/rooms');
  await page
    .locator(`.room-card[href="${new URL(invitation).pathname + new URL(invitation).search}"]`)
    .click();
  await page.getByRole('button', { name: 'Invite friends' }).click();
  await expect(page.getByLabel('Room invitation')).toHaveValue(invitation);
});

test('read together opens a contextual popup and the shared reader with live chat', async ({
  page,
  baseURL,
}) => {
  await register(page, baseURL);
  await page.goto(`/read/${manhwa}/4`);
  await page.getByRole('button', { name: 'Read together', exact: true }).click();
  await expect(page.getByLabel('Starting unit')).toHaveValue('4');
  await page.getByRole('button', { name: 'Create room', exact: true }).click();
  await page.getByRole('link', { name: 'Enter room', exact: true }).click();
  await expect(page.getByTestId('room-unit')).toHaveText('4');
  await expect(page.getByTitle('Shared reader')).toHaveAttribute(
    'src',
    new RegExp(`/read/${manhwa}/4`),
  );
  await expect(
    page.frameLocator('iframe[title="Shared reader"]').locator('.comic-reader'),
  ).toBeVisible();
  await expect(page.getByLabel('Room message', { exact: true })).toBeEnabled();
  await page.getByLabel('Room message', { exact: true }).fill('Ready for chapter four!');
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect(page.getByText('Ready for chapter four!', { exact: true })).toBeVisible();
});

test('room creation validates the initial source and keeps source details hidden from nonmembers', async ({
  page,
  baseURL,
  request,
}) => {
  await register(page, baseURL);
  const create = (data) =>
    page.request.post('/api/rooms', {
      headers: { Origin: baseURL },
      data: { name: 'Source validation', mediaId: anime, type: 'watch', ...data },
    });
  expect((await create({ sourceUrl: 'javascript:alert(1)', sourceKind: 'video' })).status()).toBe(
    400,
  );
  expect((await create({ sourceKind: 'unknown' })).status()).toBe(400);
  expect((await create({ position: -1 })).status()).toBe(400);
  const result = await create({
    unit: 5,
    sourceUrl: 'https://media.example.test/movie.mp4',
    sourceKind: 'video',
    position: 125,
  });
  expect(result.status()).toBe(201);
  const { room } = await result.json();
  expect(room.unit).toBe(5);
  expect(room.position).toBe(125);
  expect(room.sourceKind).toBe('video');
  expect(room.sourceUrl).toBe('https://media.example.test/movie.mp4');
  const preview = await request.get(`/api/rooms/${room.id}`);
  expect((await preview.json()).room.sourceUrl).toBe('');
});

test('reading rooms preserve an exact edition and language, including bonus chapters and chapter zero', async ({
  page,
  baseURL,
}) => {
  await register(page, baseURL);
  const edition = '00000000-0000-4000-8000-000000000001';
  const { user } = await (await page.request.get('/api/auth/me')).json();
  const data = await (await page.request.get(`/api/media/${manhwa}`)).json();
  const media = data.media || data;
  let room;
  const changes = [];
  const assertContext = (request) => {
    const params = new URL(request.url()).searchParams;
    expect(params.get('destination')).toBe('yoru');
    expect(params.get('selectionFingerprint')).toBeTruthy();
  };
  await page.route('**/api/poll?**', (route) => {
    if (new URL(route.request().url()).searchParams.get('roomId') !== 'verified-core-edition-room')
      return route.fallback();
    assertContext(route.request());
    return route.fulfill({
      json: { viewerId: user.id, online: { count: 1, users: [user] }, room, events: [], cursor: 0 },
    });
  });
  // Browser transport fixture for an already-authorized exact edition. Actual
  // server ownership/unknown-edition rejection is covered by native-social HTTP contracts.
  await page.route(/\/api\/rooms(?:\/[^?]*)?(?:\?|$)/, (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path.endsWith('/chat')) return route.fulfill({ json: { items: [] } });
    assertContext(request);
    if (request.method() === 'POST' && path === '/api/rooms') {
      const created = request.postDataJSON();
      expect(created.mediaId).toBe(manhwa);
      expect(created.unit).toBe(4.5);
      const selected = new URL(created.sourceUrl, baseURL);
      expect(selected.searchParams.get('chapter')).toBe(edition);
      expect(selected.searchParams.get('language')).toBe('ja');
      expect(selected.searchParams.get('source')).toBe('mangadex');
      room = {
        ...created,
        id: 'verified-core-edition-room',
        media,
        destination: 'yoru',
        hostId: user.id,
        joined: true,
        members: [user],
        memberCount: 1,
        version: 1,
        paused: true,
        position: 0,
      };
      return route.fulfill({
        status: 201,
        json: { room, inviteUrl: '/rooms/verified-core-edition-room?invite=synthetic-invitation' },
      });
    }
    if (request.method() === 'PATCH') {
      const patch = request.postDataJSON();
      changes.push(patch);
      room = { ...room, ...patch, version: room.version + 1 };
    }
    return route.fulfill({ json: { room } });
  });
  await page.route(/\/api\/media\/[^/]+\/reading-sources(?:\?|$)/, (route) =>
    route.fulfill({ json: { state: 'ready', sources: [{ id: 'mangadex', name: 'MangaDex' }] } }),
  );
  await page.route('**/api/media/*/chapters?*', (route) =>
    route.fulfill({ json: { items: [], total: 0, state: 'ready' } }),
  );
  await page.route(/\/api\/media\/[^/]+\/reader\/[^/?]+(?:\?|$)/, (route) => {
    assertContext(route.request());
    return route.fulfill({
      json: {
        id: edition,
        kind: 'remote',
        number: '4.5',
        language: 'ja',
        pages: [{ url: `/api/media/${manhwa}/reader/${edition}/page/0` }],
      },
    });
  });
  await page.route('**/api/media/*/reader/*/page/*', (route) =>
    route.fulfill({ contentType: 'image/png', body: readerImage() }),
  );
  await page.goto(`/read/${manhwa}/4.5?source=mangadex&language=ja&chapter=${edition}`);
  await expect(page.getByRole('img', { name: 'Chapter 4.5, page 1', exact: true })).toBeVisible();
  const closeReaderMenu = page.getByRole('button', { name: 'Close reader menu', exact: true });
  if (await closeReaderMenu.isVisible()) await closeReaderMenu.click();
  const revealControls = page.getByRole('button', {
    name: 'Show chapter and page controls',
    exact: true,
  });
  if (await revealControls.isVisible()) await revealControls.click();
  await page.getByRole('button', { name: 'Read together', exact: true }).click();
  await expect(page.getByLabel('Starting unit')).toHaveValue('4.5');
  await page.getByRole('button', { name: 'Create room', exact: true }).click();
  await page.getByRole('link', { name: 'Enter room', exact: true }).click();
  await expect(page.getByTestId('room-unit')).toHaveText('4.5');
  const reader = page.getByTitle('Shared reader');
  const url = new URL(await reader.getAttribute('src'), baseURL);
  expect(url.searchParams.get('chapter')).toBe(edition);
  expect(url.searchParams.get('language')).toBe('ja');
  expect(url.searchParams.get('source')).toBe('mangadex');
  await expect(
    page.frameLocator('iframe[title="Shared reader"]').locator('.comic-reader'),
  ).toBeVisible();
  await page.getByLabel('Room unit', { exact: true }).fill('0');
  await page.getByRole('button', { name: 'Go', exact: true }).click();
  await expect(page.getByTestId('room-unit')).toHaveText('0');
  await expect(reader).toHaveAttribute('src', `/read/${manhwa}/0?source=mangadex&language=ja`);
  expect(changes).toHaveLength(1);
  expect(changes[0].unit).toBe(0);
  expect(changes[0].sourceUrl).toBe(`/read/${manhwa}/0?source=mangadex&language=ja`);
});
