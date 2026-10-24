import type { App } from 'vue';
import type { Locale } from 'vue-i18n';

import type {
  ImportLocaleFn,
  LoadMessageFn,
  LocaleSetupOptions,
  SupportedLanguagesType,
} from './typing';

import policy from '../../../locale-policy.json';
import { pluralIndex } from './formatting';
import { createI18n } from 'vue-i18n';

import { useSimpleLocale } from '@vben-core/composables';

const i18n = createI18n({
  globalInjection: true,
  legacy: false,
  locale: policy.default,
  fallbackLocale: false,
  pluralRules: Object.fromEntries(Object.keys(policy.languages).map(locale => [locale, (count: number, choices: number) => pluralIndex(locale, count, choices)])),
  numberFormats: Object.fromEntries(Object.keys(policy.languages).map(locale => [locale, { decimal: { style: 'decimal' }, percent: { style: 'percent' } }])),
  datetimeFormats: Object.fromEntries(Object.keys(policy.languages).map(locale => [locale, { date: { year: 'numeric', month: 'short', day: 'numeric', calendar: 'gregory', timeZone: policy.default_time_zone }, dateTime: { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: 'numeric', calendar: 'gregory', timeZone: policy.default_time_zone } }])),
  messages: {},
});

const modules = import.meta.glob('./langs/**/*.json');

const { setSimpleLocale } = useSimpleLocale();

const localesMap = loadLocalesMapFromDir(
  /\.\/langs\/([^/]+)\/(.*)\.json$/,
  modules,
);
let loadMessages: LoadMessageFn;

/**
 * Load locale modules
 * @param modules
 */
function loadLocalesMap(modules: Record<string, () => Promise<unknown>>) {
  const localesMap: Record<Locale, ImportLocaleFn> = {};

  for (const [path, loadLocale] of Object.entries(modules)) {
    const key = path.match(/([\w-]*)\.(json)/)?.[1];
    if (key) {
      localesMap[key] = loadLocale as ImportLocaleFn;
    }
  }
  return localesMap;
}

/**
 * Load locale modules with directory structure
 * @param regexp - Regular expression to match language and file names
 * @param modules - The modules object containing paths and import functions
 * @returns A map of locales to their corresponding import functions
 */
function loadLocalesMapFromDir(
  regexp: RegExp,
  modules: Record<string, () => Promise<unknown>>,
): Record<Locale, ImportLocaleFn> {
  const localesRaw: Record<Locale, Record<string, () => Promise<unknown>>> = {};
  const localesMap: Record<Locale, ImportLocaleFn> = {};

  // Iterate over the modules to extract language and file names
  for (const path in modules) {
    const match = path.match(regexp);
    if (match) {
      const [_, locale, fileName] = match;
      if (locale && fileName) {
        if (!localesRaw[locale]) {
          localesRaw[locale] = {};
        }
        if (modules[path]) {
          localesRaw[locale][fileName] = modules[path];
        }
      }
    }
  }

  // Convert raw locale data into async import functions
  for (const [locale, files] of Object.entries(localesRaw)) {
    localesMap[locale] = async () => {
      const messages: Record<string, any> = {};
      for (const [fileName, importFn] of Object.entries(files)) {
        messages[fileName] = ((await importFn()) as any)?.default;
      }
      return { default: messages };
    };
  }

  return localesMap;
}

/**
 * Set i18n language
 * @param locale
 */
function setI18nLanguage(locale: Locale) {
  i18n.global.locale.value = locale;

  document?.querySelector('html')?.setAttribute('lang', locale);
  document?.querySelector('html')?.setAttribute('dir', policy.languages[locale as SupportedLanguagesType].direction);
}

async function setupI18n(app: App, options: LocaleSetupOptions = {}) {
  const { defaultLocale = 'zh-CN' } = options;
  // app可以自行扩展一些第三方库和组件库的国际化
  loadMessages = options.loadMessages || (async () => ({}));
  app.use(i18n);
  await loadLocaleMessages(defaultLocale);

  // 在控制台打印警告
  i18n.global.setMissingHandler((locale, key) => {
    if (options.missingWarn && key.includes('.')) {
      console.warn(
        `[intlify] Not found '${key}' key in '${locale}' locale messages.`,
      );
    }
  });
}

/**
 * Load locale messages
 * @param lang
 */
let activeRequest = 0;
const loadedLocales = new Set<SupportedLanguagesType>();
async function loadLocaleMessages(lang: SupportedLanguagesType) {
  const request = ++activeRequest;
  if (!loadedLocales.has(lang)) {
    const message = await localesMap[lang]?.();
    if (!message?.default) throw new Error(`Missing locale catalogue: ${lang}`);
    i18n.global.setLocaleMessage(lang, message.default);
  }
  const mergeMessage = await loadMessages(lang);
  if (mergeMessage) i18n.global.mergeLocaleMessage(lang, mergeMessage);
  loadedLocales.add(lang);
  if (request === activeRequest) {
    setSimpleLocale(lang);
    setI18nLanguage(lang);
  }
}

export {
  i18n,
  loadLocaleMessages,
  loadLocalesMap,
  loadLocalesMapFromDir,
  setupI18n,
};
