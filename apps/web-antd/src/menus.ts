import type { MenuRecordRaw } from '@vben/types';

import { BadgeCheck, BookOpen, Database, Files, LayoutDashboard, MessageSquare } from 'lucide-vue-next';

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
  { name: 'page.menu.verification', path: '/verification', icon: BadgeCheck },
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
];
