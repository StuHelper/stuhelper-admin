import { useI18n } from '@vben/locales';

/** Translate a stable error code; unknown codes use the generic message. */
export function useErrorText() {
  const { t, te } = useI18n();
  return (code: string) =>
    te(`page.errors.${code}`)
      ? t(`page.errors.${code}`)
      : t('page.errors.unavailable');
}
