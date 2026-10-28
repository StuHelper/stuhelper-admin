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

// The console renders no protected data without a successful, scoped server request.
// Visiting a route does not grant a role; every read and mutation is authorized by its API.
router.beforeEach((to) => to.meta.frameworkPublic === true || to.meta.academicConsole === true || { name: 'NotFound', params: { pathMatch: ['unavailable'] } });
