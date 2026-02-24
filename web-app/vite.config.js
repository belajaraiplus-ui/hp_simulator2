import { defineConfig } from 'vite';
import path from 'path';

export default defineConfig({
  server: {
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8080',
        changeOrigin: true,
        secure: false,
      },
    },
    fs: {
      allow: ['..'],
    },
  },
  resolve: {
    alias: {
      '@assets': path.resolve(__dirname, '../assets'),
    }
  },
  assetsInclude: ['**/*.json', '**/*.xml'],
});