import type { Order } from './api';

import { useI18n } from '@vben/locales';

import { useFormat } from '#/shared/format';

import { minorText } from './api';

/**
 * Amount text for billing pages. Top-ups and their refunds move yuan; points
 * purchases and their refunds move Ivory, the in-app balance, plus points.
 */
export function useMoney() {
  const { locale, t } = useI18n();
  const format = useFormat();
  // Intl formats exact decimal strings (ES2023), so no digit is lost to floating point;
  // the cast only bridges the older lib typing of format().
  const decimal = (minor: number, options: Intl.NumberFormatOptions = {}) => new Intl.NumberFormat(locale.value, { minimumFractionDigits: 2, maximumFractionDigits: 2, ...options }).format(minorText(minor) as unknown as number);
  const cny = (minor: number) => decimal(minor, { style: 'currency', currency: 'CNY' });
  const ivory = (minor: number) => t('page.billing.ivoryAmount', { amount: decimal(minor) });
  const points = (value: number) => t('page.billing.pointsAmount', { amount: format.value.number(value) });
  function order(item: Pick<Order, 'amount_minor' | 'kind' | 'points'>) {
    if (item.kind === 'topup' || item.kind === 'refund') return cny(item.amount_minor);
    return item.points ? `${ivory(item.amount_minor)} · ${points(item.points)}` : ivory(item.amount_minor);
  }
  return { cny, ivory, order, points };
}
