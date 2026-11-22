import type { SessionStore } from '#/shared/session';

import {
  computed,
  getCurrentScope,
  inject,
  type InjectionKey,
  onScopeDispose,
  readonly,
  ref,
  watch,
} from 'vue';

import { errorCode } from '#/shared/api/errors';
import { Http } from '#/shared/api/http';
import { useHostFetch } from '#/shared/api/transport';
import { isDeniedError } from '#/shared/composables/async';
import { useSession } from '#/shared/session';

import { TeacherMatchingApi } from './matchingApi';
import { SettingsApi } from './settingsApi';

type PermissionStatus = 'allowed' | 'denied' | 'error' | 'idle' | 'loading';
const retryDelay = 30_000;
const prefix = '/catalog/teacher-sites/';

/** Presentation only. Catalog still authorizes every request against the current school. */
export function createTeacherHomepageAccess(
  session: SessionStore,
  fetcher: typeof fetch,
) {
  const member = computed(() =>
    session.state.value === 'member' ? session.session.value : null,
  );
  const owner = computed(() => member.value?.profile.id ?? '');
  const school = computed(() => member.value?.content_school_id ?? '');
  const platformAdmin = computed(() => member.value?.administrator === true);
  const http = new Http(fetcher);
  const matching = new TeacherMatchingApi(http);
  const settings = new SettingsApi(http);
  // Session exposes platform administrators, while the two Catalog reads
  // also confirm explicit catalog.teacher-sites.read and catalog.maintain grants.
  const read = permission((target, signal) =>
    matching.sites(target, { limit: 1 }, signal),
  );
  const maintain = permission((target, signal) =>
    settings.readAllowlist(target, signal),
  );

  function reset() {
    read.reset();
    maintain.reset();
  }

  watch([owner, school, platformAdmin], reset, { flush: 'sync' });
  if (getCurrentScope()) onScopeDispose(reset);

  function permission(
    load: (target: string, signal: AbortSignal) => Promise<unknown>,
  ) {
    const status = ref<PermissionStatus>('idle');
    const error = ref('');
    const allowed = computed(
      () =>
        Boolean(school.value) &&
        (status.value === 'allowed' ||
          (status.value === 'idle' && platformAdmin.value)),
    );
    let current: AbortController | undefined;
    let pending: Promise<void> | undefined;
    let retryAt = 0;

    function cancel() {
      current?.abort();
      current = undefined;
      pending = undefined;
    }

    function reset() {
      cancel();
      status.value = 'idle';
      error.value = '';
      retryAt = 0;
    }

    function report(target: string, granted: boolean) {
      if (!target || target !== school.value) return;
      cancel();
      status.value = granted ? 'allowed' : 'denied';
      error.value = '';
      retryAt = Date.now() + retryDelay;
    }

    function check(retry: 'manual' | 'none' | 'scheduled' = 'none') {
      const target = school.value;
      if (pending) return pending;
      if (!target || allowed.value) return;
      if (
        status.value !== 'idle' &&
        retry !== 'manual' &&
        (retry !== 'scheduled' || Date.now() < retryAt)
      ) {
        return;
      }

      const controller = new AbortController();
      current = controller;
      status.value = 'loading';
      error.value = '';
      pending = (async () => {
        try {
          await load(target, controller.signal);
          if (current === controller) report(target, true);
        } catch (error_) {
          if (current !== controller) return;
          if (isDeniedError(error_)) {
            report(target, false);
            if (error_.status === 401) session.invalidate();
            return;
          }
          status.value = 'error';
          error.value = errorCode(error_);
          retryAt = Date.now() + retryDelay;
        } finally {
          if (current === controller) {
            current = undefined;
            pending = undefined;
          }
        }
      })();
      return pending;
    }

    return {
      allowed,
      error: readonly(error),
      // A failed read can still be retried on its page. Only positive permission
      // enables writes, and a known denial always hides the associated menu.
      visible: computed(() => allowed.value || status.value === 'error'),
      report,
      reset,
      check,
    };
  }

  function discover(path: string) {
    // The feature's own reads already authorize these routes. Elsewhere, ask
    // each question once for a delegated account in the selected school.
    const normalized = path.replace(/\/$/, '');
    const retry = normalized.startsWith('/catalog') ? 'scheduled' : 'none';
    if (normalized !== prefix + 'matching') void read.check(retry);
    if (
      normalized !== prefix + 'settings' &&
      normalized !== prefix + 'profile' &&
      normalized !== prefix + 'requests'
    ) {
      void maintain.check(retry);
    }
  }

  function canShowMenu(path: string) {
    if (!path.startsWith(prefix)) return true;
    return path === prefix + 'matching'
      ? read.visible.value
      : maintain.visible.value;
  }

  return {
    owner,
    school,
    platformAdmin,
    discover,
    canShowMenu,
    canRead: read.allowed,
    canMaintain: maintain.allowed,
    maintainError: maintain.error,
    checkMaintain: () => maintain.check(),
    retryMaintain: () => maintain.check('manual'),
    reportRead: read.report,
    reportMaintain: maintain.report,
  };
}

export const teacherHomepageAccessKey: InjectionKey<
  ReturnType<typeof createTeacherHomepageAccess>
> = Symbol('teacherHomepageAccess');

export function useTeacherHomepageAccess() {
  const access = inject(teacherHomepageAccessKey);
  return access ?? createTeacherHomepageAccess(useSession(), useHostFetch());
}
