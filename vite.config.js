import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { searchIndexPlugin } from './scripts/search-index-plugin.mjs';
export default defineConfig({
  plugins: [react(), searchIndexPlugin()],
  server: { host: '127.0.0.1', port: 5183, proxy: { '/api': 'http://127.0.0.1:5184' } },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (/node_modules[\\/](react|react-dom|react-router|react-router-dom)[\\/]/.test(id))
            return 'react';
        },
      },
    },
  },
});
