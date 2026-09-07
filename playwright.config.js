import { defineConfig, devices } from '@playwright/test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Never use the developer's database or silently attach to an existing server.
// A unique OS temp directory isolates every run, including simultaneous runs.
const dataDir = mkdtempSync(join(tmpdir(), 'yoru-e2e-'));
const port = Number(process.env.YORU_E2E_PORT || 5185);
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : 4,
  timeout: 30_000,
  expect: { timeout: 10_000 },
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    serviceWorkers: 'block',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile-chromium', use: { ...devices['Pixel 7'] } },
  ],
  webServer: {
    command: 'node server/index.js',
    url: `${baseURL}/api/health`,
    reuseExistingServer: false,
    timeout: 30_000,
    env: {
      NODE_ENV: 'test',
      PORT: String(port),
      APP_ORIGIN: baseURL,
      COOKIE_SECURE: 'false',
      TRUST_PROXY: '0',
      DATA_DIR: dataDir,
      YORU_DB_PATH: join(dataDir, 'yoru.sqlite'),
      CATALOG_OFFLINE: '1',
      DISCORD_CLIENT_ID: '',
      DISCORD_CLIENT_SECRET: '',
      DISCORD_REDIRECT_URI: '',
      MAL_CLIENT_ID: '',
      MAL_CLIENT_SECRET: '',
      MAL_REDIRECT_URI: '',
      MAL_TOKEN_ENCRYPTION_KEY: '',
    },
  },
});
