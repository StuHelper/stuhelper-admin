import { computed } from 'vue';

import { createFormatters, useI18n } from '@vben/locales';
import { preferences } from '@vben/preferences';

import { formatBytes } from '../api/capacity';

export { formatBytes };

/** Locale-aware formatters for the current language and the configured time zone. */
export function useFormat() {
  const { locale } = useI18n();
  return computed(() => ({
    ...createFormatters(locale.value, preferences.app.timezone),
    bytes: (value: number) => formatBytes(locale.value, value),
  }));
}
