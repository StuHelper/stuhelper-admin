import { defineConfig } from '@vben/vite-config';

export default defineConfig(() => {
  const target = process.env.STUHELPER_API_TARGET || 'http://127.0.0.1:8080';
  const proxy = { '/api': { target, changeOrigin: false } };
  return {
    application: { nitroMock: false, pwa: false, archiver: false, devtools: false },
    vite: {
      server: { host: '127.0.0.1', strictPort: true, proxy },
      preview: { host: '127.0.0.1', strictPort: true, proxy },
    },
  };
});
