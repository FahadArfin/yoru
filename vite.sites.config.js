import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { cloudflare } from '@cloudflare/vite-plugin';
import { sites } from '@openai/sites-vite-plugin';
import { fileURLToPath } from 'node:url';
// Hosted secrets are supplied by Sites; never copy local dotenv values into a build.
process.env.CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV = 'false';

export default defineConfig({
  plugins: [
    react(),
    cloudflare({ configPath: './wrangler.sites.jsonc', viteEnvironment: { name: 'server' } }),
    sites(),
  ],
  resolve: {
    alias: [
      {
        find: /^\.\/catalog-storage\.js$/,
        replacement: fileURLToPath(new URL('./sites/catalog-storage.js', import.meta.url)),
      },
    ],
  },
  server: { host: '127.0.0.1', port: 5186 },
});
