import type { RouteRecordRaw } from 'vue-router';

// Prototype pages are opt-in at build time and never part of the default bundle routes.
export const prototypesEnabled = import.meta.env.VITE_PROTOTYPES === 'true';

const pages = [
  { key: 'eligibility', title: '动作资格', icon: 'lucide:list-checks', load: () => import('./EligibilityView.vue') },
  { key: 'roles', title: '角色与范围', icon: 'lucide:users', load: () => import('./RolesView.vue') },
  { key: 'audit', title: '操作记录', icon: 'lucide:history', load: () => import('./AuditView.vue') },
  { key: 'groups', title: '群聊管理', icon: 'lucide:messages-square', load: () => import('./GroupsView.vue') },
  { key: 'entertainment', title: '娱乐功能', icon: 'lucide:dice-5', load: () => import('./EntertainmentView.vue') },
  { key: 'query', title: '信息查询', icon: 'lucide:search', load: () => import('./QueryView.vue') },
  { key: 'notifications', title: '通知设置', icon: 'lucide:bell', load: () => import('./NotificationsView.vue') },
  { key: 'open-platform', title: '开放平台', icon: 'lucide:plug', load: () => import('./OpenPlatformView.vue') },
  { key: 'discovery', title: '发现与统计', icon: 'lucide:trending-up', load: () => import('./DiscoveryView.vue') },
  { key: 'billing', title: '账务', icon: 'lucide:wallet', load: () => import('./BillingView.vue') },
  { key: 'retention', title: '数据留存', icon: 'lucide:archive', load: () => import('./RetentionView.vue') },
];

export const prototypeRoutes: RouteRecordRaw[] = prototypesEnabled
  ? pages.map((page) => ({ name: `Prototype-${page.key}`, path: `/prototype/${page.key}`, component: page.load, meta: { title: page.title, frameworkPublic: true } }))
  : [];

export const prototypeMenu = prototypesEnabled
  ? [{ name: '原型预览', path: '/_prototype', icon: 'lucide:flask-conical', children: pages.map((page) => ({ name: page.title, path: `/prototype/${page.key}`, icon: page.icon })) }]
  : [];

export const prototypePathOf: Record<string, string> = {
  eligibility: '/prototype/eligibility', roles: '/prototype/roles', auditLog: '/prototype/audit', notifications: '/prototype/notifications',
  groups: '/prototype/groups', entertainment: '/prototype/entertainment', informationQuery: '/prototype/query', openPlatform: '/prototype/open-platform',
  discovery: '/prototype/discovery', billing: '/prototype/billing', retention: '/prototype/retention',
};
