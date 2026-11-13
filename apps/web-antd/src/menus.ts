import type { MenuRecordRaw } from '@vben/types';

import { BadgeCheck, BookOpen, Coins, Database, Files, KeyRound, LayoutDashboard, Link2, MessageSquare, MessagesSquare, ShieldUser } from 'lucide-vue-next';

import { routeCapability } from './shared/capabilities';

// Sidebar grouped by business area. Menus only guide navigation; the server
// decides on every request whether the administrator may see the data.
export const menus: MenuRecordRaw[] = [
  { name: 'page.menu.overview', path: '/', icon: LayoutDashboard },
  {
    name: 'page.menu.moderation',
    path: '/moderation',
    icon: MessageSquare,
    children: [
      { name: 'page.menu.moderationQueue', path: '/moderation/queue' },
      { name: 'page.menu.moderationContent', path: '/moderation/content' },
      { name: 'page.menu.moderationPolicies', path: '/moderation/policies' },
      { name: 'page.menu.moderationPresentation', path: '/moderation/presentation' },
    ],
  },
  {
    name: 'page.menu.catalogGroup',
    path: '/catalog-group',
    icon: BookOpen,
    children: [
      { name: 'page.menu.catalog', path: '/catalog' },
      { name: 'page.menu.catalogImports', path: '/catalog/imports' },
      { name: 'page.menu.catalogTimetable', path: '/catalog/timetable' },
    ],
  },
  {
    name: 'page.menu.resourcesGroup',
    path: '/resources-group',
    icon: Files,
    children: [
      { name: 'page.menu.resources', path: '/resources' },
      { name: 'page.menu.resourceReviews', path: '/resources/reviews' },
      { name: 'page.menu.resourceCategories', path: '/resources/categories' },
      { name: 'page.menu.resourceDirectories', path: '/resources/directories' },
    ],
  },
  {
    name: 'page.menu.verificationGroup',
    path: '/verification-group',
    icon: BadgeCheck,
    children: [
      { name: 'page.menu.verification', path: '/verification' },
      { name: 'page.menu.teacherVerification', path: '/verification/teachers' },
    ],
  },
  {
    name: 'page.menu.billingGroup',
    path: '/billing-group',
    icon: Coins,
    children: [
      { name: 'page.menu.billingRefunds', path: '/billing/refunds' },
      { name: 'page.menu.billingAccounts', path: '/billing/accounts' },
      { name: 'page.menu.billingMemberships', path: '/billing/memberships' },
      { name: 'page.menu.billingConfig', path: '/billing/config' },
    ],
  },
  { name: 'page.menu.qqGroups', path: '/qq/groups', icon: MessagesSquare },
  { name: 'page.menu.qqBinding', path: '/qq-binding', icon: Link2 },
  { name: 'page.menu.openPlatform', path: '/open-platform', icon: KeyRound },
  {
    name: 'page.menu.storageGroup',
    path: '/storage-group',
    icon: Database,
    children: [
      { name: 'page.menu.storage', path: '/storage' },
      { name: 'page.menu.custody', path: '/storage/custody' },
      { name: 'page.menu.contributions', path: '/storage/contributions' },
    ],
  },
  {
    name: 'page.menu.accessGroup',
    path: '/system',
    icon: ShieldUser,
    children: [
      { name: 'page.sessionPolicy.title', path: '/system/sessions' },
      { name: 'page.menu.accessRoles', path: '/system/roles' },
      { name: 'page.menu.eligibility', path: '/system/eligibility' },
      { name: 'page.menu.lookup', path: '/system/lookup' },
      { name: 'page.menu.accessAudit', path: '/system/audit' },
    ],
  },
];

/** Empty groups disappear along with their unavailable children. */
export function availableMenus(has: (capability: string) => boolean, items = menus): MenuRecordRaw[] {
  return items.flatMap((item) => {
    const capability = routeCapability(item.path);
    if (capability && !has(capability)) return [];
    if (!item.children) return [item];
    const children = availableMenus(has, item.children);
    return children.length > 0 ? [{ ...item, children }] : [];
  });
}
