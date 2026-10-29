import { defineConfig } from '@vben/eslint-config';

import i18n from '@intlify/eslint-plugin-vue-i18n';
export default defineConfig([
  { ignores: ['**/*.gen.ts', 'apps/web-antd/src/api/contribution.ts', 'apps/web-antd/src/api/custody.ts'] },
  ...i18n.configs['flat/base'],
  { settings: { 'vue-i18n': { localeDir: [
    { pattern: './apps/web-antd/src/locales/langs/*/*.json', localeKey: 'path', localePattern: /langs\/(?<locale>[^/]+)\// },
    { pattern: './packages/locales/src/langs/*/*.json', localeKey: 'path', localePattern: /langs\/(?<locale>[^/]+)\// },
  ], messageSyntaxVersion: '^11.0.0' } }, rules: {
    '@intlify/vue-i18n/valid-message-syntax': 'error',
  } },
  { files: ['apps/web-antd/src/**/*.vue'], rules: {
    '@intlify/vue-i18n/no-raw-text': ['error', { attributes: { '/.*/': ['title', 'description', 'sub-title', 'aria-label', 'placeholder', 'alt'] }, ignorePattern: String.raw`^[0-9\s/]*$` }],
    'no-restricted-syntax': ['error', { selector: String.raw`Literal[value=/[\u4e00-\u9fff]/]`, message: 'Use a locale message for user-facing text.' }],
  } },
]);
