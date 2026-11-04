import { defineOverridesPreferences } from '@vben/preferences';

export const overridesPreferences = defineOverridesPreferences({
  app: {
    name: 'stuhelper-admin'
    ,locale: 'zh-CN',
    defaultHomePath: '/',
    defaultAvatar: '/brand.png',
    enableCheckUpdates: false,
  },
  theme: { mode: 'light', radius: '0.5' },
  logo: { source: '/brand.png', sourceDark: '/brand.png' },
  copyright: { companyName: 'StuHelper', companySiteLink: '', date: '2026' },
  footer: { enable: true },
  widget: { lockScreen: false, notification: false, globalSearch: false },
  shortcutKeys: { globalLockScreen: false, globalLogout: false },
});
