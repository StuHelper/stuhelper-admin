import { computed } from 'vue';

import { createFormatters, useI18n } from '@vben/locales';
import { preferences } from '@vben/preferences';

const units = [
  'byte',
  'kilobyte',
  'megabyte',
  'gigabyte',
  'terabyte',
  'petabyte',
];

/** Decimal byte units, matching the GB values administrators type into quota forms. */
export function formatBytes(locale: string, value: number) {
  if (!Number.isFinite(value) || value < 0)
    throw new RangeError('Invalid byte count');
  let amount = value;
  let index = 0;
  while (amount >= 1000 && index < units.length - 1) {
    amount /= 1000;
    index++;
  }
  return new Intl.NumberFormat(locale, {
    style: 'unit',
    unit: units[index],
    unitDisplay: 'short',
    maximumFractionDigits: index === 0 ? 0 : 1,
  }).format(amount);
}

/** Locale-aware formatters for the current language and the configured time zone. */
export function useFormat() {
  const { locale } = useI18n();
  return computed(() => ({
    ...createFormatters(locale.value, preferences.app.timezone),
    bytes: (value: number) => formatBytes(locale.value, value),
  }));
}
