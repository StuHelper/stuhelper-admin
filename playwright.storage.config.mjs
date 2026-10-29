import { defineConfig, devices } from 'playwright/test';

export default defineConfig({
  outputDir: '.tools/playwright.storage.config-results',
  testDir: './tests/e2e', timeout: 30_000, workers: 2, retries: 0,
  reporter: 'list', use: { trace: 'off', screenshot: 'off' },
  projects: ['zh-CN', 'en-US', 'fr-FR', 'ru-RU', 'ja-JP', 'ko-KR', 'es-ES', 'ar-EG'].flatMap(locale => [
    { name: `desktop-${locale}`, metadata: { locale }, use: { ...devices['Desktop Chrome'] } },
    { name: `mobile-${locale}`, metadata: { locale }, use: { ...devices['Pixel 7'] } },
  ]),
  webServer: { command: 'make preview', env: { STUHELPER_PREVIEW_PORT: '18786' }, url: 'http://127.0.0.1:18786', reuseExistingServer: false, timeout: 60_000, gracefulShutdown: { signal: 'SIGTERM', timeout: 5000 } },
});
