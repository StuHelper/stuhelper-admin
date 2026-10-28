import { createRouter, createWebHistory } from 'vue-router';

import { verification } from '#/api/verification';

export const router = createRouter({
  history: createWebHistory(import.meta.env.VITE_BASE),
  routes: [
    {
      name: 'Root', path: '/', component: () => import('#/layouts/basic.vue'),
      children: [{
        name: 'Framework', path: '', component: () => import('#/views/framework.vue'),
        meta: { title: 'page.framework.title', frameworkPublic: true, affixTab: true },
      }, {
        name: 'Verification', path: 'verification', component: () => import('#/views/verification.vue'),
        meta: { title: 'page.verification.adminTitle', verificationProtected: true },
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

// Business routes require a current server decision, including after permissions change.
router.beforeEach(async (to) => {
  if (to.meta.frameworkPublic === true) return true;
  if (to.meta.verificationProtected === true) {
    try { return await verification.consoleAccess(); } catch { /* The destination stays unavailable. */ }
  }
  return { name: 'NotFound', params: { pathMatch: ['unavailable'] } };
});
