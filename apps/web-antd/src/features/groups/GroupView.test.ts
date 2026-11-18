// @vitest-environment happy-dom
import { createApp, h, nextTick, ref } from 'vue';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { createSessionStore, sessionKey } from '#/shared/session';

import GroupView from './GroupView.vue';

let leaveGuardFn: (() => string) | undefined;

vi.mock('vue-router', () => ({
  onBeforeRouteLeave: (fn: () => boolean) => {
    leaveGuardFn = () => (fn() === false ? 'blocked' : '');
  },
  onBeforeRouteUpdate: () => {},
  RouterLink: (
    props: { to?: string },
    { slots }: { slots: { default?: () => unknown } },
  ) => h('a', { href: props.to }, slots.default?.() as never),
}));

vi.mock('@vben/locales', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@vben/locales')>();
  return {
    ...actual,
    useI18n: () => ({
      locale: ref('zh-CN'),
      t: (key: string, values?: Record<string, unknown>) =>
        values ? `${key}:${JSON.stringify(values)}` : key,
      te: (key: string) =>
        key.startsWith('page.groups.ruleKinds.keyword') ||
        !key.includes('unknown_custom_rule'),
    }),
  };
});

const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const clean of cleanups.splice(0)) clean();
  leaveGuardFn = undefined;
  vi.restoreAllMocks();
});

const zero = '0001-01-01T00:00:00Z';
const makeConfig = (id: string, name: string, number: string) => ({
  accept_alumni: false,
  accept_temporary: true,
  auto_actions: ['warn'],
  auto_card: false,
  block_links: false,
  bot_enabled: true,
  card_template: '{name}',
  check_card: true,
  cooldown_seconds: 300,
  dice_sides: 6,
  frequency_limit: 8,
  frequency_seconds: 10,
  grace_seconds: 72 * 3600,
  id,
  keywords: ['spam'],
  mode: 'before',
  mute_probability: 10,
  mute_seconds: 60,
  name,
  number,
  password_set: false,
  pity: 10,
  remind_card: true,
  reminder_seconds: 24 * 3600,
  repeat_threshold: 5,
  require_student: true,
  retention_seconds: 7 * 86_400,
  revision: 3,
  rules_template: 'Be kind',
  school: 'buaa',
  warning_limit: 3,
  welcome: 'Welcome',
});

const makeMember = (owner: string) => ({
  deadline: '2026-11-12T00:00:00Z',
  exempt: false,
  extended: false,
  failures: 0,
  id: owner,
  joined: true,
  last_play: zero,
  muted_until: zero,
  owner,
  password: false,
  reminder: zero,
  state: 'grace',
});

describe('GroupView route switching, uncertain write locking, and rule localization (A-16, A-20)', () => {
  it('reloads group header and panels when route param id changes, locks modal and leave guard on uncertain command, and localizes hit rules', async () => {
    const groupId = ref('g1');
    let failCommand = true;
    const posts: Array<[string, null | string]> = [];
    let resolved = false;

    const fetcher: typeof fetch = async (input, init) => {
      const path = new URL(String(input), 'http://localhost').pathname;
      if (init?.method === 'POST' && path.endsWith('/commands')) {
        posts.push([path, new Headers(init.headers).get('Idempotency-Key')]);
        if (failCommand) {
          return new Response('gateway timeout', { status: 503 });
        }
        return Response.json({
          action: 'recheck',
          detail: '',
          id: 'act-1',
          state: 'unknown',
          value: 0,
        });
      }
      if (path === '/api/v1/groups/g1') {
        return Response.json(makeConfig('g1', 'Algorithms Q&A', '****4821'));
      }
      if (path === '/api/v1/groups/g2') {
        return Response.json(makeConfig('g2', 'Physics Lab', '****9999'));
      }
      if (path === '/api/v1/groups/g1/members') {
        return Response.json({ items: [makeMember('user-7')], next_cursor: '' });
      }
      if (path === '/api/v1/groups/g2/members') {
        return Response.json({
          items: [makeMember('user-42'), makeMember('user-99')],
          next_cursor: '',
        });
      }
      if (path === '/api/v1/groups/g2/actions' && resolved) {
        return Response.json({ items: [{
          id: 'act-1', group: 'g2', actor: { issuer: 'issuer', subject: 'admin' },
          capability: 'groups.read', command: { kind: 'recheck', target: 'user-42' },
          state: 'succeeded', result: '', created: zero,
        }], next_cursor: '' });
      }
      if (path.endsWith('/hits')) {
        return Response.json({
          items: [
            {
              id: 'hit-1',
              message: 'msg-1',
              owner: 'user-42',
              rules: ['keyword'],
              state: 'pending',
            },
          ],
          next_cursor: '',
        });
      }
      return Response.json({ items: [], next_cursor: '' });
    };

    vi.stubGlobal('fetch', fetcher);
    vi.stubGlobal(
      'window',
      Object.assign(globalThis.window, {
        confirm: () => false,
        location: {
          assign: vi.fn(),
          href: 'http://localhost/',
          origin: 'http://localhost',
        },
      }),
    );

    const store = createSessionStore(fetcher);
    const root = document.createElement('div');
    document.body.append(root);
    const app = createApp({
      setup: () => () => h(GroupView, { id: groupId.value }),
    });
    app.provide(sessionKey, store);
    app.mount(root);
    cleanups.push(() => {
      app.unmount();
      root.remove();
    });

    await vi.waitFor(() => {
      expect(root.textContent).toContain('Algorithms Q&A');
      expect(root.textContent).toContain('user-7');
    });

    // A-16 (1): Navigating from /qq/groups/g1 to /qq/groups/g2 must reload header & members!
    groupId.value = 'g2';
    await vi.waitFor(() => {
      expect(root.textContent).toContain('Physics Lab');
      expect(root.textContent).toContain('user-42');
    });
    expect(root.textContent).not.toContain('user-7');

    // A-20: Hits tab localizes rule code via page.groups.ruleKinds.keyword
    const hitsTab = [...root.querySelectorAll('[role="tab"]')].find((el) =>
      el.textContent?.includes('page.groups.tabs.hits'),
    ) as HTMLElement | undefined;
    hitsTab?.click();
    await vi.waitFor(() => {
      expect(root.textContent).toContain('page.groups.ruleKinds.keyword');
    });

    const membersTab = [...root.querySelectorAll('[role="tab"]')].find((el) =>
      el.textContent?.includes('page.groups.tabs.members'),
    ) as HTMLElement | undefined;
    membersTab?.click();
    await nextTick();

    // A-16 (2): Uncertain command locks leave guard and prevents switching target to user-99
    const manageButtons = () =>
      [...root.querySelectorAll<HTMLButtonElement>('button')].filter((b) =>
        b.textContent?.includes('page.groups.manage'),
      );
    manageButtons()[0]?.click();
    await vi.waitFor(() => {
      expect(document.body.textContent).toContain('page.groups.commandTitle');
      expect(document.body.textContent).toContain('user-42');
    });

    const sendBtn = [
      ...document.querySelectorAll<HTMLButtonElement>('.ant-modal button'),
    ].find((b) => b.textContent?.includes('page.groups.send'));
    sendBtn?.click();

    await vi.waitFor(() => {
      expect(document.body.textContent).toContain('page.common.uncertain');
    });

    // Leave guard must block route navigation while command outcome is uncertain
    expect(leaveGuardFn?.()).toBe('blocked');

    // Clicking manage on user-99 must NOT switch draft.target while uncertain!
    expect(manageButtons()[1]?.disabled).toBe(true);
    manageButtons()[1]?.click();
    await nextTick();
    expect(document.body.textContent).toContain('user-42');

    groupId.value = 'g1';
    await vi.waitFor(() => expect(root.textContent).toContain('Algorithms Q&A'));
    const modalButton = (key: string) =>
      [...document.querySelectorAll<HTMLButtonElement>('.ant-modal button')].find((b) => b.textContent?.includes(key));
    failCommand = false;
    expect(modalButton('page.common.retryOriginal')).toBeTruthy();
    modalButton('page.common.retryOriginal')!.click();
    await vi.waitFor(() => expect(document.body.textContent).toContain('page.groups.states.unknown'));
    expect(posts).toHaveLength(2);
    expect(posts[0]?.[0]).toBe('/api/v1/groups/g2/commands');
    expect(posts[0]?.[1]).toBeTruthy();
    expect(posts[1]).toEqual(posts[0]);
    expect(manageButtons()[0]?.disabled).toBe(true);
    expect(leaveGuardFn?.()).toBe('blocked');
    resolved = true;
    modalButton('page.common.refresh')!.click();
    await vi.waitFor(() => expect(manageButtons()[0]?.disabled).toBe(false));
    expect(posts).toHaveLength(2);
  }, 20_000);
});
