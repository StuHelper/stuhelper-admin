import { defineOverridesPreferences } from '@vben/preferences';

export const overridesPreferences = defineOverridesPreferences({
  app: {
    name: 'stuhelper-admin',
    locale: 'zh-CN',
    defaultHomePath: '/',
    defaultAvatar: '/brand.png',
    enableCheckUpdates: false,
    enablePreferences: false,
  },
  theme: { builtinType: 'custom', colorPrimary: 'hsl(217 91% 45%)', mode: 'auto', radius: '0.25' },
  transition: { enable: false, name: 'fade', progress: true, loading: false },
  tabbar: { enable: true, showIcon: false },
  breadcrumb: { showIcon: false },
  sidebar: { width: 200 },
  logo: { source: '/brand.png', sourceDark: '/brand.png' },
  copyright: { companyName: 'StuHelper', companySiteLink: '', date: '2026' },
  footer: { enable: true },
  widget: { fullscreen: false, globalSearch: false, lockScreen: false, notification: false, sidebarToggle: true },
  shortcutKeys: { globalLockScreen: false, globalLogout: false },
});
