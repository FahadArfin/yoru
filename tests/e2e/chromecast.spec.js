import { test, expect } from '@playwright/test';

const id = 'mal-anime-52991';
const sdkUrl = '**/cast_sender.js?*';
const mockSdk = `(() => {
  const listeners = new Set();
  const emit = () => { for (const fn of listeners) fn(); };
  let connected = false;
  let media = null;
  let player;
  const session = {
    getCastDevice: () => ({friendlyName: 'Living room TV'}),
    getMediaSession: () => media ? {media} : null,
    loadMedia: async request => {
      window.castRequest = request;
      if (window.castFailLoad) throw {code: 'load_media_failed'};
      media = request.media;
      Object.assign(player, {isMediaLoaded: true, isConnected: true, currentTime: request.currentTime});
      emit();
    },
  };
  const context = {
    setOptions: options => window.castOptions = options,
    getCurrentSession: () => connected ? session : null,
    requestSession: async () => {
      window.castPickerCalls = (window.castPickerCalls || 0) + 1;
      if (window.castCancel) throw {code: 'cancel'};
      connected = true; emit();
    },
    endCurrentSession: () => {connected = false; player.isMediaLoaded = false; emit();},
    addEventListener: (name, fn) => listeners.add(fn),
    removeEventListener: (name, fn) => listeners.delete(fn),
  };
  window.cast = {framework: {
    CastContext: {getInstance: () => context},
    CastContextEventType: {SESSION_STATE_CHANGED: 'session'},
    RemotePlayerEventType: {ANY_CHANGE: 'change'},
    RemotePlayer: class {constructor() {Object.assign(this, {isMediaLoaded: false, canPause: true, canSeek: true, isPaused: false, currentTime: 0, duration: 1400}); player = this;}},
    RemotePlayerController: class {
      addEventListener(name, fn) {listeners.add(fn);}
      removeEventListener(name, fn) {listeners.delete(fn);}
      playOrPause() {player.isPaused = !player.isPaused; emit();}
      seek() {emit();}
    },
  }};
  window.chrome ||= {};
  window.chrome.cast = {
    AutoJoinPolicy: {TAB_AND_ORIGIN_SCOPED: 'tab'},
    Image: class {constructor(url) {this.url = url;}},
    media: {
      DEFAULT_MEDIA_RECEIVER_APP_ID: 'CC1AD845', StreamType: {BUFFERED: 'BUFFERED'},
      MediaInfo: class {constructor(contentId, contentType) {Object.assign(this, {contentId, contentType});}},
      GenericMediaMetadata: class {},
      LoadRequest: class {constructor(media) {this.media = media;}},
    },
  };
  window.advanceCast = time => {player.currentTime = time; emit();};
  window.__onGCastApiAvailable(true);
})();`;

test.beforeEach(async ({ context, baseURL, page }) => {
  await context.route('**/*', (route) =>
    new URL(route.request().url()).origin === baseURL ? route.continue() : route.abort(),
  );
  await page.route(`**/api/media/${id}/sources?*`, (route) =>
    route.fulfill({
      json: {
        mediaId: id,
        episode: 1,
        language: 'sub',
        items: [
          {
            id: 'direct',
            label: 'Direct video',
            kind: 'video',
            url: 'https://cdn.example.test/episode.mp4',
          },
        ],
      },
    }),
  );
});

async function nativePlayer(page) {
  await page.goto(`/watch/${id}/1?source=direct`);
  await expect(page.locator('video')).toBeVisible();
  await page.locator('video').evaluate((video) => {
    Object.defineProperty(video, 'currentTime', { value: 47, writable: true, configurable: true });
    Object.defineProperty(video, 'duration', { value: 1400, configurable: true });
    video.pause = () => (window.localPauseCount = (window.localPauseCount || 0) + 1);
  });
  await expect(page.getByRole('button', { name: 'Cast', exact: true })).toBeEnabled();
}

test('direct Cast hands off current position, controls TV and restores position without local autoplay', async ({
  page,
}) => {
  await page.route(sdkUrl, (route) =>
    route.fulfill({ contentType: 'application/javascript', body: mockSdk }),
  );
  await nativePlayer(page);
  expect(await page.evaluate(() => window.castPickerCalls || 0)).toBe(0);
  await page.getByRole('button', { name: 'Cast', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Pause on TV' })).toBeVisible();
  const request = await page.evaluate(() => window.castRequest);
  expect(request.currentTime).toBe(47);
  expect(request.media.contentId).toBe('https://cdn.example.test/episode.mp4');
  expect(request.media.contentType).toBe('video/mp4');
  expect(request.media.metadata.title).toContain('Episode 1');
  expect(await page.evaluate(() => window.localPauseCount)).toBeGreaterThan(0);
  await page.getByRole('button', { name: 'Pause on TV' }).click();
  await expect(page.getByRole('button', { name: 'Resume on TV' })).toBeVisible();
  await page.evaluate(() => window.advanceCast(123));
  await page.getByRole('button', { name: '+30 sec', exact: true }).click();
  await page.getByRole('button', { name: 'Stop casting' }).click();
  expect(await page.locator('video').evaluate((video) => video.currentTime)).toBe(153);
  await expect(page.getByRole('button', { name: 'Cast', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('failed Cast load leaves local playback intact and allows retry; cancelled chooser is quiet', async ({
  page,
}) => {
  await page.route(sdkUrl, (route) =>
    route.fulfill({ contentType: 'application/javascript', body: mockSdk }),
  );
  await nativePlayer(page);
  await page.evaluate(() => (window.castCancel = true));
  await page.getByRole('button', { name: 'Cast', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Choose TV' })).toBeEnabled();
  await expect(page.locator('#watch-cast-panel [role="alert"]')).toHaveCount(0);
  await page.evaluate(() => {
    window.castCancel = false;
    window.castFailLoad = true;
  });
  await page.getByRole('button', { name: 'Choose TV' }).click();
  await expect(page.locator('#watch-cast-panel [role="alert"]')).toContainText(
    'Could not cast this source',
  );
  expect(await page.evaluate(() => window.localPauseCount || 0)).toBe(0);
  await page.evaluate(() => (window.castFailLoad = false));
  await page.getByRole('button', { name: 'Choose TV' }).click();
  await expect(page.getByRole('button', { name: 'Pause on TV' })).toBeVisible();
});

test('embedded providers explain the limitation without loading Cast or reloading the iframe', async ({
  page,
}) => {
  let sdkRequests = 0;
  await page.route(sdkUrl, (route) => {
    sdkRequests++;
    return route.abort();
  });
  await page.route(`**/api/media/${id}/sources?*`, (route) =>
    route.fulfill({
      json: {
        mediaId: id,
        episode: 1,
        language: 'sub',
        items: [
          { id: 'embed', kind: 'embed', label: 'MegaPlay', url: 'https://megaplay.buzz/stream/1' },
        ],
      },
    }),
  );
  await page.goto(`/watch/${id}/1`);
  await page.locator('iframe').evaluate((frame) => (frame.dataset.identity = 'retained'));
  await page.getByRole('button', { name: 'Cast', exact: true }).click();
  await expect(
    page.getByText('This provider uses an embedded player.', { exact: false }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Choose TV' })).toHaveCount(0);
  await expect(page.locator('iframe')).toHaveAttribute('data-identity', 'retained');
  expect(sdkRequests).toBe(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('unavailable SDK explains browser support and can be retried', async ({ page }) => {
  await page.route(sdkUrl, (route) => route.abort());
  await nativePlayer(page);
  await page.getByRole('button', { name: 'Cast', exact: true }).click();
  await expect(page.getByText('Google Cast is unavailable here.', { exact: false })).toBeVisible();
  await page.route(sdkUrl, (route) =>
    route.fulfill({ contentType: 'application/javascript', body: mockSdk }),
  );
  await page.getByRole('button', { name: 'Retry Cast setup' }).click();
  await expect(page.getByRole('button', { name: 'Choose TV' })).toBeVisible();
});
