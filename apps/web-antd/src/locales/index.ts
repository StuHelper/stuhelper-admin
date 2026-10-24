import type { Locale } from 'ant-design-vue/es/locale';

import type { App } from 'vue';

import type { LocaleSetupOptions, SupportedLanguagesType } from '@vben/locales';

import { ref, watch } from 'vue';

import { $t, setupI18n as coreSetup, i18n, loadLocalesMapFromDir } from '@vben/locales';
import { preferences } from '@vben/preferences';

import antdAr from 'ant-design-vue/es/locale/ar_EG';
import antdEn from 'ant-design-vue/es/locale/en_US';
import antdEs from 'ant-design-vue/es/locale/es_ES';
import antdFr from 'ant-design-vue/es/locale/fr_FR';
import antdJa from 'ant-design-vue/es/locale/ja_JP';
import antdKo from 'ant-design-vue/es/locale/ko_KR';
import antdRu from 'ant-design-vue/es/locale/ru_RU';
import antdZh from 'ant-design-vue/es/locale/zh_CN';
import dayjs from 'dayjs';

import policy from '../../../../locale-policy.json';

const antdLocales: Record<SupportedLanguagesType, Locale> = { 'zh-CN': antdZh, 'en-US': antdEn, 'fr-FR': antdFr, 'ru-RU': antdRu, 'ja-JP': antdJa, 'ko-KR': antdKo, 'es-ES': antdEs, 'ar-EG': antdAr };
const antdLocale = ref<Locale>(antdZh);
const modules = import.meta.glob('./langs/**/*.json');
const localesMap = loadLocalesMapFromDir(/\.\/langs\/([^/]+)\/(.*)\.json$/, modules);
const dayjsLoaders = {
  'zh-CN': () => import('dayjs/locale/zh-cn'), 'en-US': () => import('dayjs/locale/en'),
  'fr-FR': () => import('dayjs/locale/fr'), 'ru-RU': () => import('dayjs/locale/ru'),
  'ja-JP': () => import('dayjs/locale/ja'), 'ko-KR': () => import('dayjs/locale/ko'),
  'es-ES': () => import('dayjs/locale/es'), 'ar-EG': () => import('dayjs/locale/ar'),
};
const dayjsNames = { 'zh-CN': 'zh-cn', 'en-US': 'en', 'fr-FR': 'fr', 'ru-RU': 'ru', 'ja-JP': 'ja', 'ko-KR': 'ko', 'es-ES': 'es', 'ar-EG': 'ar' };
async function loadMessages(lang: SupportedLanguagesType) {
  const [messages] = await Promise.all([localesMap[lang]?.(), dayjsLoaders[lang]()]);
  if (preferences.app.locale === lang) {
    antdLocale.value = antdLocales[lang];
    dayjs.locale(dayjsNames[lang]);
  }
  return messages?.default;
}
async function setupI18n(app: App, options: LocaleSetupOptions = {}) {
  await coreSetup(app, { defaultLocale: preferences.app.locale, loadMessages, missingWarn: true, ...options });
  watch(() => preferences.app.timezone, (timeZone) => {
    for (const locale of Object.keys(policy.languages)) {
      i18n.global.setDateTimeFormat(locale, {
        date: { year: 'numeric', month: 'short', day: 'numeric', calendar: 'gregory', timeZone },
        dateTime: { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: 'numeric', calendar: 'gregory', timeZone },
      });
    }
  }, { immediate: true });
}
export { $t, antdLocale, setupI18n };
