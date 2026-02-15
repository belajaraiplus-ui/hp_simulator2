import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    proxy: {
      // Setiap request ke /api akan diteruskan ke backend Rust/Server di port 8080
      '/api': {
        target: 'http://127.0.0.1:8080',
        changeOrigin: true,
        secure: false,
      }
    }
  }
});