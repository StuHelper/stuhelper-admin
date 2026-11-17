// @vitest-environment happy-dom
import type { Closure } from './api';

import { createApp, h, nextTick, ref } from 'vue';
import { createMemoryHistory, createRouter, RouterView } from 'vue-router';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from '#/shared/api/errors';

import { canProcessClosure } from './api';
import ClosuresView from './ClosuresView.vue';

const mock = vi.hoisted(() => ({
  json: vi.fn(),
  sessionState: null as null | ReturnType<typeof ref<'guest' | 'member'>>,
}));

vi.mock('#/shared/session', async () => {
  const vue = await import('vue');
  mock.sessionState ??= vue.ref<'guest' | 'member'>('member');
  return {
    useHttp: () => ({ json: mock.json }),
    useSession: () => ({ state: mock.sessionState! }),
  };
});
vi.mock('@vben/locales', () => ({
  useI18n: () => ({
    t: (key: string, values?: Record<string, unknown>) =>
      values ? `${key}:${JSON.stringify(values)}` : key,
    te: () => true,
  }),
}));
vi.mock('#/shared/format', async () => {
  const vue = await import('vue');
  return {
    useFormat: () =>
      vue.computed(() => ({
        dateTime: (value: string) => value,
        number: String,
        list: (items: string[]) => items.join(', '),
      })),
  };
});
vi.mock('#/shared/ui/messages', () => ({
  useErrorText: () => (value: string) => `err:${value}`,
}));
vi.mock('#/shared/ui/AdminPage.vue', () => ({
  default: { template: '<div><slot /></div>' },
}));

const blockedClosure = (): Closure => ({
  id: '00000000-0000-4000-8000-000000000010',
  profile_id: '00000000-0000-4000-8000-000000000099',
  state: 'processing',
  revision: 2,
  requested_at: '2026-11-01T00:00:00Z',
  cooling_ends_at: '2026-11-08T00:00:00Z',
  completed_steps: ['assets', 'sessions'],
  skipped_modules: ['open-platform'],
  blocker: 'content_unavailable',
  points_policy: 'forfeit_all_points_and_pending_deductions',
});

const coolingClosure = (): Closure => ({
  ...blockedClosure(),
  id: '00000000-0000-4000-8000-000000000011',
  profile_id: '00000000-0000-4000-8000-000000000088',
  state: 'cooling',
  completed_steps: [],
  blocker: '',
  cooling_ends_at: '2026-11-25T00:00:00Z',
});

const fixedNow = () => Date.parse('2026-11-18T00:00:00Z');
const cleanups: (() => void)[] = [];

afterEach(() => {
  for (const clean of cleanups.splice(0)) clean();
  mock.json.mockReset();
  if (mock.sessionState) mock.sessionState.value = 'member';
});

async function settle() {
  for (let i = 0; i < 4; i++) {
    await Promise.resolve();
    await nextTick();
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

async function mountView() {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      {
        path: '/system/closures',
        component: { render: () => h(ClosuresView, { now: fixedNow }) },
      },
      { path: '/', component: { template: '<p>Home</p>' } },
    ],
  });
  const root = document.createElement('div');
  document.body.append(root);
  const app = createApp({ render: () => h(RouterView) });
  app.use(router);
  await router.push('/system/closures');
  app.mount(root);
  await settle();
  cleanups.push(() => {
    app.unmount();
    root.remove();
  });
  return { root, router };
}

describe('Account closures administration', () => {
  it('enforces cooling deadline and terminal states in canProcessClosure', () => {
    expect(canProcessClosure(blockedClosure(), fixedNow())).toBe(true);
    expect(canProcessClosure(coolingClosure(), fixedNow())).toBe(false);
    expect(
      canProcessClosure({ ...blockedClosure(), state: 'closed' }, fixedNow()),
    ).toBe(false);
    expect(
      canProcessClosure(
        { ...blockedClosure(), state: 'cancelled' },
        fixedNow(),
      ),
    ).toBe(false);
  });

  it('retries an uncertain closure process request with the original idempotency key and blocks navigation', async () => {
    const keys: string[] = [];
    let fail = true;
    mock.json.mockImplementation(
      async (
        path: string,
        _validate: unknown,
        options?: { key?: string; method?: string },
      ) => {
        if (options?.method === 'POST') {
          keys.push(options.key ?? '');
          if (fail) {
            fail = false;
            throw new ApiError('network', true);
          }
          return {
            ...blockedClosure(),
            state: 'closed',
            blocker: '',
            completed_steps: ['assets', 'sessions', 'authorizations', 'content'],
            completed_at: '2026-11-18T00:01:00Z',
            revision: 3,
          };
        }
        if (path.endsWith('/00000000-0000-4000-8000-000000000010'))
          return blockedClosure();
        return { items: [blockedClosure(), coolingClosure()] };
      },
    );

    const confirm = vi.fn(() => false);
    Object.defineProperty(window, 'confirm', {
      value: confirm,
      configurable: true,
    });
    cleanups.push(() => {
      Reflect.deleteProperty(window, 'confirm');
    });

    const { root, router } = await mountView();
    const openButtons = [...document.querySelectorAll('button')].filter((btn) =>
      btn.textContent?.includes('page.common.open'),
    );
    expect(openButtons.length).toBe(2);
    openButtons[0]!.click();
    await settle();

    const processBtn = [...document.querySelectorAll('button')].find((btn) =>
      btn.textContent?.includes('page.closures.process'),
    );
    expect(processBtn).toBeDefined();
    expect(processBtn!.disabled).toBe(false);
    processBtn!.click();
    await settle();

    await router.push('/');
    expect(router.currentRoute.value.path).toBe('/system/closures');
    expect(confirm).toHaveBeenCalledWith('page.common.leaveUncertain');

    const retryBtn = [...document.querySelectorAll('button')].find((btn) =>
      btn.textContent?.includes('page.common.retryOriginal'),
    );
    expect(retryBtn).toBeDefined();
    retryBtn!.click();
    await settle();

    expect(keys).toHaveLength(2);
    expect(keys[0]).not.toBe('');
    expect(keys[1]).toBe(keys[0]);
    expect(document.body.textContent).toContain(
      'page.closures.completedNotice',
    );
    expect(root.textContent).toContain('00000000-0000-4000-8000-000000000099');
  });

  it('clears listed closures and open detail when permission is revoked', async () => {
    let denied = false;
    mock.json.mockImplementation(async (path: string) => {
      if (denied) throw new ApiError('forbidden', false, 403);
      if (path.endsWith('/00000000-0000-4000-8000-000000000010'))
        return blockedClosure();
      return { items: [blockedClosure()] };
    });

    const { root } = await mountView();
    expect(root.textContent).toContain('00000000-0000-4000-8000-000000000099');

    const openBtn = [...document.querySelectorAll('button')].find((btn) =>
      btn.textContent?.includes('page.common.open'),
    );
    openBtn!.click();
    await settle();
    expect(document.body.textContent).toContain(
      'page.closures.blockers.content_unavailable',
    );

    denied = true;
    const refreshButtons = [...document.querySelectorAll('button')].filter(
      (btn) => btn.textContent?.includes('page.common.refresh'),
    );
    refreshButtons.at(-1)!.click();
    await settle();

    expect(root.textContent).not.toContain(
      '00000000-0000-4000-8000-000000000099',
    );
    expect(document.body.textContent).not.toContain(
      'page.closures.blockers.content_unavailable',
    );
  });
});
