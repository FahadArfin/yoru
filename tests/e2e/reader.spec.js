import { test, expect } from '@playwright/test';
import { readerImage } from '../fixtures/reader-image.mjs';

const manifest = {
  title: 'Reader test edition',
  chapters: {
    1: {
      title: 'The beginning',
      volume: '1',
      language: 'en',
      groups: {
        'Test edition': [
          'https://images.example.org/1.png',
          'https://images.example.org/2.png',
          'https://images.example.org/3.png',
        ],
      },
    },
    1.5: {
      title: 'Interlude',
      volume: '1',
      language: 'en',
      groups: { 'Test edition': ['https://images.example.org/4.png'] },
    },
    2: {
      title: 'A new day',
      volume: '1',
      language: 'es',
      groups: { 'Otra edición': ['https://images.example.org/5.png'] },
    },
  },
};
const pixel = readerImage();

async function setup(page, context, baseURL) {
  await context.route('**/*', (route) =>
    new URL(route.request().url()).origin === baseURL ? route.continue() : route.abort(),
  );
  await page.route('https://images.example.org/**', (route) =>
    route.fulfill({ contentType: 'image/png', body: pixel }),
  );
}
async function importManifest(page) {
  await page.getByRole('button', { name: 'Add chapters', exact: true }).click();
  await page.getByLabel('Chapter manifest').setInputFiles({
    name: 'reader.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(manifest)),
  });
  await page.getByRole('button', { name: 'Import chapters', exact: true }).click();
}

test('native reader preserves page, edition, bookmarks and settings through reload', async ({
  page,
  context,
  baseURL,
}) => {
  await setup(page, context, baseURL);
  await page.goto('/read/mal-manga-21/1');
  await importManifest(page);
  await expect(page.getByRole('img', { name: 'Chapter 1, page 1', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Next page', exact: true }).click();
  await expect(page.getByLabel('Page number', { exact: true })).toHaveValue('2');
  await page.getByRole('button', { name: 'Bookmark page', exact: true }).click();
  await page.getByRole('button', { name: 'Reader settings', exact: true }).click();
  await page.getByLabel('Reading direction').selectOption('ltr');
  await page.getByLabel('Background').selectOption('sepia');
  await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await page.reload();
  await expect(page.getByLabel('Page number', { exact: true })).toHaveValue('2');
  await expect(page.getByRole('button', { name: 'Remove bookmark', exact: true })).toBeVisible();
  await expect(page.locator('.comic-reader')).toHaveAttribute('data-background', 'sepia');
  await page.getByRole('button', { name: 'Chapters', exact: true }).click();
  const chapters = page.getByRole('dialog', { name: 'Chapters', exact: true });
  await chapters.getByLabel('Chapter language').selectOption('es');
  await expect(
    chapters.getByRole('button', { name: /Read chapter 2 · Otra edición/ }),
  ).toBeVisible();
  await expect(chapters.getByRole('button', { name: /Read chapter 1 · Test edition/ })).toHaveCount(
    0,
  );
  await chapters.getByRole('button', { name: /Read chapter 2 · Otra edición/ }).click();
  await expect(page.getByLabel('Page number', { exact: true })).toHaveValue('1');
  await expect(page.getByRole('img', { name: 'Chapter 2, page 1', exact: true })).toBeVisible();
  await page.goto('/browse/manga');
  await expect(
    page
      .getByRole('region', { name: 'Continue reading' })
      .getByRole('link', { name: /Death Note/ }),
  ).toBeVisible();
  await page.goto('/browse/manhwa');
  await expect(page.getByRole('region', { name: 'Continue reading' })).toHaveCount(0);
});

test('manhwa defaults to webtoon and image files stay on the device after reload', async ({
  page,
  context,
  baseURL,
}) => {
  await setup(page, context, baseURL);
  await page.goto('/read/mal-manga-121496/1');
  await page.getByRole('button', { name: 'Add chapters', exact: true }).click();
  await page.getByRole('tab', { name: 'Image files', exact: true }).click();
  await page.getByLabel('Chapter images').setInputFiles([
    { name: 'page-10.png', mimeType: 'image/png', buffer: pixel },
    { name: 'page-2.png', mimeType: 'image/png', buffer: pixel },
    { name: 'page-11.png', mimeType: 'image/png', buffer: pixel },
  ]);
  await page.getByRole('button', { name: 'Import chapter', exact: true }).click();
  await expect(page.locator('.reader-canvas')).toHaveAttribute('data-mode', 'webtoon');
  await expect(page.getByRole('img', { name: 'Chapter 1, page 1', exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('img', { name: 'Chapter 1, page 1', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Next page', exact: true }).click();
  await expect(page.getByLabel('Page number', { exact: true })).toHaveValue('2');
  await page.reload();
  await expect(page.getByLabel('Page number', { exact: true })).toHaveValue('2');
  await expect(page.getByRole('img', { name: 'Chapter 1, page 2', exact: true })).toBeInViewport();
  await page.setViewportSize({ width: 1280, height: 720 });
  await expect(page.locator('.reader-canvas')).toHaveJSProperty('clientWidth', 995);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect
    .poll(async () =>
      page
        .locator('[data-page="2"]')
        .evaluate((element) =>
          Math.abs(
            element.getBoundingClientRect().top -
              element.closest('.reader-canvas').getBoundingClientRect().top,
          ),
        ),
    )
    .toBeLessThan(5);
  await expect(page.getByLabel('Page number', { exact: true })).toHaveValue('2');
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  await page.getByRole('button', { name: 'Reader settings', exact: true }).click();
  await page.getByLabel('Image fit').selectOption('original');
  await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await page.setViewportSize({ width: 1600, height: 1000 });
  await expect
    .poll(async () =>
      page
        .locator('[data-page="2"]')
        .evaluate((element) =>
          Math.abs(
            element.getBoundingClientRect().height -
              element.querySelector('img').getBoundingClientRect().height,
          ),
        ),
    )
    .toBeLessThan(5);
});

test('reader keyboard, spread layout, retry and modal focus preserve the correct page', async ({
  page,
  context,
  baseURL,
}) => {
  await setup(page, context, baseURL);
  let available = false;
  await page.route('https://images.example.org/3.png', (route) =>
    available ? route.fulfill({ contentType: 'image/png', body: pixel }) : route.abort(),
  );
  await page.goto('/read/mal-manga-21/1');
  await importManifest(page);
  await page.locator('.reader-canvas').focus();
  await page.keyboard.press('ArrowLeft');
  await expect(page.getByLabel('Page number', { exact: true })).toHaveValue('2');
  await page.keyboard.press('ArrowRight');
  await expect(page.getByLabel('Page number', { exact: true })).toHaveValue('1');
  await page.keyboard.press('s');
  const settings = page.getByRole('dialog', { name: 'Reader settings', exact: true });
  await settings.getByRole('button', { name: 'Double page', exact: true }).click();
  await page.keyboard.press('ArrowLeft');
  await expect(page.getByLabel('Page number', { exact: true })).toHaveValue('1');
  await page.keyboard.press('Escape');
  await expect(settings).toHaveCount(0);
  await expect(page.locator('.reader-canvas img')).toHaveCount(2);
  await page.getByRole('button', { name: 'Next page', exact: true }).click();
  await expect(page.getByLabel('Page number', { exact: true })).toHaveValue('3');
  await expect(page.getByRole('button', { name: 'Retry page 3', exact: true })).toBeVisible();
  available = true;
  await page.getByRole('button', { name: 'Retry page 3', exact: true }).click();
  await expect(page.getByRole('img', { name: 'Chapter 1, page 3', exact: true })).toBeVisible();
  await page.locator('.reader-canvas').focus();
  await page.keyboard.press('f');
  await expect(page.getByRole('button', { name: 'Show controls', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Show controls', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Next chapter', exact: true }).click();
  await expect(page.getByRole('img', { name: 'Chapter 1.5, page 1', exact: true })).toBeVisible();
  await expect(
    page.getByRole('link', { name: 'Title discussion', exact: true, includeHidden: true }),
  ).toHaveAttribute('href', '/title/mal-manga-21?unit=0');
  // Follow the destination on phones too, where the compact footer hides this shortcut.
  const discussion = await page
    .getByRole('link', { name: 'Title discussion', exact: true, includeHidden: true })
    .getAttribute('href');
  const request = page.waitForRequest(
    (r) => new URL(r.url()).pathname === '/api/comments/mal-manga-21',
  );
  await page.goto(discussion);
  expect(new URL((await request).url()).searchParams.get('unit')).toBe('0');
  await expect(page.getByText('Discussion for the whole title.', { exact: true })).toBeVisible();
});

test('dismissing an image import prevents a late redirect or chapter save', async ({
  page,
  context,
  baseURL,
}) => {
  await setup(page, context, baseURL);
  await page.addInitScript(() => {
    const decode = window.createImageBitmap.bind(window);
    window.createImageBitmap = async (...args) => {
      window.readerDecodeWaiting = true;
      await new Promise((resolve) => {
        window.resumeReaderDecode = resolve;
      });
      const image = await decode(...args);
      window.readerDecodeDone = true;
      return image;
    };
  });
  await page.goto('/read/mal-manga-121496/1');
  await page.getByRole('button', { name: 'Add chapters', exact: true }).click();
  await page.getByRole('tab', { name: 'Image files', exact: true }).click();
  await page
    .getByLabel('Chapter images')
    .setInputFiles({ name: 'page.png', mimeType: 'image/png', buffer: pixel });
  await page.getByRole('button', { name: 'Import chapter', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.readerDecodeWaiting)).toBe(true);
  await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await page.getByRole('link', { name: 'Back to Solo Leveling', exact: true }).click();
  await expect(page).toHaveURL(/\/title\/mal-manga-121496$/);
  await page.evaluate(() => window.resumeReaderDecode());
  await expect.poll(() => page.evaluate(() => window.readerDecodeDone)).toBe(true);
  const redirected = await page.waitForURL(/\/read\//, { timeout: 1000 }).then(
    () => true,
    () => false,
  );
  expect(redirected).toBe(false);
  await page.getByRole('tab', { name: 'Chapters', exact: true }).click();
  await expect(
    page
      .locator('.saved-chapter-heading')
      .getByText('Add your chapter files to read in Yoru and keep your place.', { exact: true }),
  ).toBeVisible();
  await expect(page.locator('.saved-chapter-heading .chapter-row')).toHaveCount(0);
});
