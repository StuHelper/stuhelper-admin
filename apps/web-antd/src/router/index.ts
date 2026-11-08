import type { RouteRecordRaw } from 'vue-router';

import { createRouter, createWebHistory } from 'vue-router';

const academic = {
  moderation: () => import('#/features/academic/ModerationView.vue'),
};

const children: RouteRecordRaw[] = [
  { name: 'Overview', path: '', component: () => import('#/features/overview/OverviewView.vue'), meta: { title: 'page.menu.overview', affixTab: true } },
  { name: 'ModerationQueue', path: 'moderation/queue', component: academic.moderation, props: { mode: 'queue' }, meta: { title: 'page.menu.moderationQueue' } },
  { name: 'ModerationContent', path: 'moderation/content', component: academic.moderation, props: { mode: 'content' }, meta: { title: 'page.menu.moderationContent' } },
  { name: 'ModerationPolicies', path: 'moderation/policies', component: () => import('#/features/academic/PolicyView.vue'), meta: { title: 'page.menu.moderationPolicies' } },
  { name: 'ModerationPresentation', path: 'moderation/presentation', component: () => import('#/features/academic/PresentationView.vue'), meta: { title: 'page.menu.moderationPresentation' } },
  { name: 'Catalog', path: 'catalog', component: () => import('#/features/academic/CatalogView.vue'), meta: { title: 'page.menu.catalog' } },
  { name: 'CatalogImports', path: 'catalog/imports', component: () => import('#/features/academic/ImportView.vue'), meta: { title: 'page.menu.catalogImports' } },
  { name: 'Resources', path: 'resources', component: () => import('#/features/resources/ResourcesView.vue'), meta: { title: 'page.menu.resources' } },
  { name: 'ResourceReviews', path: 'resources/reviews', component: () => import('#/features/resources/ReviewView.vue'), meta: { title: 'page.menu.resourceReviews' } },
  { name: 'ResourceCategories', path: 'resources/categories', component: () => import('#/features/resources/CategoriesView.vue'), meta: { title: 'page.menu.resourceCategories' } },
  { name: 'ResourceDirectories', path: 'resources/directories', component: () => import('#/features/resources/DirectoriesView.vue'), meta: { title: 'page.menu.resourceDirectories' } },
  { name: 'Verification', path: 'verification', component: () => import('#/features/verification/VerificationView.vue'), meta: { title: 'page.menu.verification' } },
  { name: 'TeacherVerification', path: 'verification/teachers', component: () => import('#/features/verification/TeacherView.vue'), meta: { title: 'page.menu.teacherVerification' } },
  { name: 'BillingRefunds', path: 'billing/refunds', component: () => import('#/features/billing/RefundsView.vue'), meta: { title: 'page.menu.billingRefunds' } },
  { name: 'BillingAccounts', path: 'billing/accounts', component: () => import('#/features/billing/AccountView.vue'), meta: { title: 'page.menu.billingAccounts' } },
  { name: 'BillingConfig', path: 'billing/config', component: () => import('#/features/billing/ConfigView.vue'), meta: { title: 'page.menu.billingConfig' } },
  { name: 'AccessRoles', path: 'system/roles', component: () => import('#/features/access/RolesView.vue'), meta: { title: 'page.menu.accessRoles' } },
  { name: 'AccessAudit', path: 'system/audit', component: () => import('#/features/access/AuditView.vue'), meta: { title: 'page.menu.accessAudit' } },
  { name: 'QqBinding', path: 'qq-binding', component: () => import('#/features/qq-binding/BindingView.vue'), meta: { title: 'page.menu.qqBinding' } },
  { name: 'OpenPlatform', path: 'open-platform', component: () => import('#/features/open-platform/AppsView.vue'), meta: { title: 'page.menu.openPlatform' } },
  { name: 'Storage', path: 'storage', component: () => import('#/features/storage/StorageView.vue'), meta: { title: 'page.menu.storage' } },
  { name: 'StorageCustody', path: 'storage/custody', component: () => import('#/features/storage/CustodyView.vue'), meta: { title: 'page.menu.custody' } },
  { name: 'StorageContributions', path: 'storage/contributions', component: () => import('#/features/storage/ContributionsView.vue'), meta: { title: 'page.menu.contributions' } },
];

/**
 * Routes carry no local role or access flag: every page asks the server, and
 * an unauthorized response clears the page's data.
 */
export const router = createRouter({
  history: createWebHistory(import.meta.env.VITE_BASE),
  routes: [
    { name: 'Root', path: '/', component: () => import('#/layouts/basic.vue'), children },
    { name: 'NotFound', path: '/:pathMatch(.*)*', component: () => import('#/features/overview/NotFoundView.vue'), meta: { title: 'page.framework.unavailable' } },
  ],
  scrollBehavior: () => ({ top: 0 }),
});
