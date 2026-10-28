import { createRouter, createWebHistory } from 'vue-router';

export const router = createRouter({
  history: createWebHistory(import.meta.env.VITE_BASE),
  routes: [
    {
      name: 'Root', path: '/', component: () => import('#/layouts/basic.vue'),
      children: [{
        name: 'Framework', path: '', component: () => import('#/views/framework.vue'),
        meta: { title: 'page.framework.title', frameworkPublic: true, affixTab: true },
      }, {
        name: 'Contributions', path: 'contributions', component: () => import('#/views/contributions.vue'),
        meta: { title: 'page.contribution.adminTitle', serverAuthorized: true },
      }, {
        name: 'Custody', path: 'storage-accounts', component: () => import('#/views/custody.vue'),
        meta: { title: 'page.custody.adminTitle', serverAuthorized: true },
      }, {
        name: 'Storage', path: 'storage', component: () => import('#/views/storage.vue'),
        meta: { title: 'page.storage.title', serverAuthorized: true },
      }, {
        name: 'AcademicReviews', path: '/academic/reviews', component: () => import('#/academic/ModerationView.vue'),
        meta: { title: 'page.academic.adminTitle', academicConsole: true },
      }, {
        name: 'AcademicCatalog', path: '/academic/catalog', component: () => import('#/academic/CatalogView.vue'),
        meta: { title: 'page.academic.catalogTitle', academicConsole: true },
      }],
    },
    {
      name: 'NotFound', path: '/:pathMatch(.*)*',
      component: () => import('#/views/not-found.vue'),
      meta: { title: 'page.framework.unavailable', frameworkPublic: true },
    },
  ],
  scrollBehavior: () => ({ top: 0 }),
});

// Server-authorized pages render an empty access boundary until the protected
// API succeeds. No local role or public-route flag grants access to business data.
router.beforeEach((to) => to.meta.frameworkPublic === true || to.meta.serverAuthorized === true || to.meta.academicConsole === true || { name: 'NotFound', params: { pathMatch: ['unavailable'] } });
