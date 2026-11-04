import { prototypeMenu } from './prototypes';

import './navigation-icons';

// Navigation only lists entrances. Every protected page still asks the server
// for access, so a visible menu item never grants permission.
type AdminMenu = { children?: AdminMenu[]; icon: string; name: string; path: string };

export const adminMenus: AdminMenu[] = [
  { name: 'page.framework.title', path: '/', icon: 'lucide:layout-dashboard' },
  {
    name: 'page.nav.content', path: '/_content', icon: 'lucide:shield-check',
    children: [
      { name: 'page.academic.adminTitle', path: '/academic/reviews', icon: 'lucide:message-square' },
      { name: 'page.resources.adminTitle', path: '/resources', icon: 'lucide:files' },
    ],
  },
  {
    name: 'page.nav.campus', path: '/_campus', icon: 'lucide:graduation-cap',
    children: [
      { name: 'page.verification.adminTitle', path: '/verification', icon: 'lucide:badge-check' },
      { name: 'page.academic.catalogTitle', path: '/academic/catalog', icon: 'lucide:book-open' },
    ],
  },
  {
    name: 'page.nav.storage', path: '/_storage', icon: 'lucide:database',
    children: [
      { name: 'page.storage.title', path: '/storage', icon: 'lucide:server' },
      { name: 'page.custody.adminTitle', path: '/storage-accounts', icon: 'lucide:key-round' },
      { name: 'page.contribution.adminTitle', path: '/contributions', icon: 'lucide:hard-drive' },
    ],
  },
  { name: 'page.settings.title', path: '/settings', icon: 'lucide:settings-2' },
  ...prototypeMenu,
];

export const quickLinks = [
  { title: 'page.academic.adminTitle', path: '/academic/reviews', icon: 'lucide:message-square' },
  { title: 'page.verification.adminTitle', path: '/verification', icon: 'lucide:badge-check' },
  { title: 'page.resources.adminTitle', path: '/resources', icon: 'lucide:files' },
  { title: 'page.academic.catalogTitle', path: '/academic/catalog', icon: 'lucide:book-open' },
  { title: 'page.storage.title', path: '/storage', icon: 'lucide:server' },
  { title: 'page.settings.title', path: '/settings', icon: 'lucide:settings-2' },
];

// Keys under page.settings.items. Each available item links to the page that
// holds the editor; the editor keeps showing scope, source and conflict results.
export const availableSettings = [
  { key: 'moderationPolicy', path: '/academic/reviews' },
  { key: 'reviewPresentation', path: '/academic/reviews' },
  { key: 'resourceCategories', path: '/resources' },
  { key: 'catalogImport', path: '/academic/catalog' },
  { key: 'verificationSchools', path: '/verification' },
  { key: 'storageQuota', path: '/storage' },
  { key: 'custodyPolicy', path: '/storage-accounts' },
  { key: 'contributionPolicy', path: '/contributions' },
];

export const plannedSettings = [
  'eligibility', 'roles', 'auditLog', 'notifications', 'groups',
  'entertainment', 'informationQuery', 'openPlatform', 'discovery', 'billing', 'retention',
];
