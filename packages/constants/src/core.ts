import policy from '../../../locale-policy.json';
/**
 * @zh_CN 登录页面 url 地址
 */
export const LOGIN_PATH = '/auth/login';

export interface LanguageOption {
  label: string;
  value: keyof typeof policy.languages;
}

/**
 * Supported languages
 */
export const SUPPORT_LANGUAGES: LanguageOption[] = Object.entries(policy.languages).map(([value, language]) => ({ label: language.name, value: value as LanguageOption['value'] }));
