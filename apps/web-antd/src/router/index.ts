import { createRouter, createWebHistory } from 'vue-router';

export const router = createRouter({
  history: createWebHistory(import.meta.env.VITE_BASE),
  routes: [
    {
      name: 'Root', path: '/', component: () => import('#/layouts/basic.vue'),
      children: [{
        name: 'Framework', path: '', component: () => import('#/views/framework.vue'),
        meta: { title: 'page.framework.title', frameworkPublic: true, affixTab: true },
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

// The only public routes are the empty framework page and its fallback.
// New business routes stay unavailable until the real identity adapter is added.
router.beforeEach((to) => to.meta.frameworkPublic === true || { name: 'NotFound', params: { pathMatch: ['unavailable'] } });
