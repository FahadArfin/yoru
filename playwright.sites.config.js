import base from './playwright.config.js';
import { defineConfig } from '@playwright/test';
const port = Number(process.env.YORU_E2E_PORT || 5187);
const baseURL = `http://127.0.0.1:${port}`;
export default defineConfig({
  ...base,
  use: { ...base.use, baseURL },
  webServer: {
    command: 'node scripts/sites-test-server.mjs',
    url: `${baseURL}/api/health`,
    reuseExistingServer: false,
    timeout: 30000,
    env: { YORU_E2E_PORT: String(port) },
  },
});
