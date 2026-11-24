import { createApp, watch, watchEffect } from 'vue';

import { registerAccessDirective } from '@vben/access';
import { registerLoadingDirective } from '@vben/common-ui/es/loading';
import { preferences } from '@vben/preferences';
import { initStores, useAccessStore } from '@vben/stores';
import '@vben/styles';
import '@vben/styles/antd';

import { useTitle } from '@vueuse/core';

import { $t, setupI18n } from '#/locales';

import { initComponentAdapter } from './adapter/component';
import { initSetupVbenForm } from './adapter/form';
import App from './app.vue';
import {
  catalogJumpKey,
  createCatalogJumpStore,
} from './features/academic/catalogJump';
import { createLegalMenuAccess } from './features/legal/menu-access';
import {
  createTeacherHomepageAccess,
  teacherHomepageAccessKey,
} from './features/teacher-homepage/access';
import { availableMenus } from './menus';
import { router } from './router';
import { accountJumpKey, createAccountJumpStore } from './shared/account-jump';
import { mediaFetch } from './shared/api/media';
import { hostFetchKey, imageFetchKey, sessionFetch } from './shared/api/transport';
import {
  capabilitiesKey,
  createCapabilities,
  routeCapability,
} from './shared/capabilities';
import { createSessionStore, sessionKey } from './shared/session';

import './styles/theme.css';

async function bootstrap(namespace: string, fetcher: typeof fetch = sessionFetch) {
  // 初始化组件适配器
  await initComponentAdapter();

  // 初始化表单组件
  await initSetupVbenForm();

  // // 设置弹窗的默认配置
  // setDefaultModalProps({
  //   fullscreenButton: false,
  // });
  // // 设置抽屉的默认配置
  // setDefaultDrawerProps({
  //   zIndex: 1020,
  // });

  const app = createApp(App);
  const capabilities = createCapabilities(fetcher);
  app.provide(capabilitiesKey, capabilities);
  void capabilities.load();
  const session = createSessionStore(fetcher);
  const teacherHomepageAccess = createTeacherHomepageAccess(session, fetcher);
  const legalMenu = createLegalMenuAccess(fetcher);
  watch(
    [
      () => session.authenticatedSession.value?.csrf_token,
      () => session.authenticatedSession.value?.consent_required || session.session.value?.administrator,
    ],
    ([, mayManage]) => legalMenu.changeSession(!!mayManage),
    { flush: 'sync' },
  );
  const accountJump = createAccountJumpStore();
  const catalogJump = createCatalogJumpStore();
  app
    .provide(hostFetchKey, legalMenu.transport)
    .provide(imageFetchKey, fetcher === sessionFetch && import.meta.env.VITE_DEMO !== '1' ? mediaFetch : fetcher)
    .provide(sessionKey, session)
    .provide(teacherHomepageAccessKey, teacherHomepageAccess)
    .provide(accountJumpKey, accountJump)
    .provide(catalogJumpKey, catalogJump);
  watch(
    () => session.session.value?.profile.id,
    (next, previous) => {
      if (previous && previous !== next) {
        accountJump.clear();
        catalogJump.clear();
      }
    },
  );
  void session.reload();

  // 注册v-loading指令
  registerLoadingDirective(app, {
    loading: 'loading', // 在这里可以自定义指令名称，也可以明确提供false表示不注册这个指令
    spinning: 'spinning',
  });

  // 国际化 i18n 配置
  await setupI18n(app);

  // 配置 pinia-tore
  await initStores(app, { namespace });
  const accessStore = useAccessStore();
  watchEffect(() =>
    accessStore.setAccessMenus(
      availableMenus(
        capabilities.has,
        legalMenu.allowed.value,
        undefined,
        (path) => path === '/system/event-retries'
          ? session.session.value?.event_retry_operator === true
          : teacherHomepageAccess.canShowMenu(path),
      ),
    ),
  );

  // 安装权限指令
  registerAccessDirective(app);

  // 初始化 tippy
  const { initTippy } = await import('@vben/common-ui/es/tippy');
  initTippy(app);

  // 配置路由及路由守卫
  app.use(router);
  watch(
    [
      () => router.currentRoute.value.matched.length > 0 ? router.currentRoute.value.path : '',
      teacherHomepageAccess.owner,
      teacherHomepageAccess.school,
      teacherHomepageAccess.platformAdmin,
    ],
    ([path]) => {
      if (path) teacherHomepageAccess.discover(path);
    },
    { immediate: true },
  );

  // 配置Motion插件
  const { MotionPlugin } = await import('@vben/plugins/motion');
  app.use(MotionPlugin);

  // 动态更新标题
  const pageTitle = useTitle();
  watchEffect(() => {
    if (preferences.app.dynamicTitle) {
      const current = router.currentRoute.value;
      const required = routeCapability(current.path);
      const disabled =
        !!required &&
        capabilities.status.value !== 'loading' &&
        !capabilities.has(required);
      const routeTitle = disabled
        ? 'page.errors.disabled'
        : current.meta?.title;
      pageTitle.value =
        (routeTitle ? `${$t(routeTitle)} - ` : '') + preferences.app.name;
    }
  });

  app.mount('#app');
}

export { bootstrap };
