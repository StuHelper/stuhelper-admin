// @vitest-environment happy-dom
import { createApp, nextTick } from 'vue';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { createSessionStore, sessionKey } from '#/shared/session';

import SessionSettingsView from './SessionSettingsView.vue';

vi.mock('vue-router', () => ({
  onBeforeRouteLeave: () => {},
  onBeforeRouteUpdate: () => {},
}));

vi.mock('@vben/locales', () => ({
  useI18n: () => ({ t: (key: string) => key, te: () => true }),
}));

vi.mock('#/shared/ui/AdminPage.vue', () => ({
  default: { template: '<div><slot /></div>' },
}));

const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const clean of cleanups.splice(0)) clean();
  vi.restoreAllMocks();
});

describe('SessionSettingsView idempotency and SessionMutationResult check (A-07)', () => {
  it('sends Idempotency-Key, rejects revoke { success: false }, and retries uncertain writes with the original key', async () => {
    let revokeMode: 'false' | 'lost' | 'true' = 'false';
    const revokeKeys: Array<null | string> = [];

    const fetcher: typeof fetch = async (input, init) => {
      const path = new URL(String(input), 'http://localhost').pathname;
      if (path === '/api/v1/admin/session-policy') {
        return Response.json({
          grace_minutes: 30,
          interval_minutes: 30,
          version: 1,
        });
      }
      if (path === '/api/v1/admin/sessions/revoke') {
        revokeKeys.push(new Headers(init?.headers).get('Idempotency-Key'));
        if (revokeMode === 'false') {
          return Response.json({ success: false });
        }
        if (revokeMode === 'lost') {
          throw new TypeError('network down');
        }
        return Response.json({ success: true });
      }
      return Response.json({}, { status: 404 });
    };

    vi.stubGlobal('fetch', fetcher);
    vi.stubGlobal(
      'window',
      Object.assign(globalThis.window, {
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
    const app = createApp(SessionSettingsView);
    app.provide(sessionKey, store);
    app.mount(root);
    cleanups.push(() => {
      app.unmount();
      root.remove();
    });

    await vi.waitFor(() => {
      expect(
        (root.querySelector('#session-review') as HTMLInputElement)?.disabled,
      ).toBe(false);
    });

    const subject = root.querySelector('#session-subject') as HTMLInputElement;
    subject.value = 'user-42';
    subject.dispatchEvent(new Event('input'));
    await nextTick();
    const checkbox = root.querySelector(
      'input[type="checkbox"]',
    ) as HTMLInputElement;
    checkbox.click();
    await nextTick();
    expect(checkbox.checked).toBe(true);

    const submitRevoke = root.querySelectorAll('form')[1]?.querySelector(
      'button[type="submit"]',
    ) as HTMLButtonElement;
    expect(submitRevoke.disabled).toBe(false);
    submitRevoke.click();

    // { success: false } must NOT claim success
    await vi.waitFor(() => {
      expect(root.querySelector('[role="alert"]')).not.toBeNull();
    });
    expect(root.textContent).not.toContain('page.sessionPolicy.revoked');
    expect(revokeKeys[0]).toBeTruthy();

    // Uncertain write locks inputs and retries with the exact original Idempotency-Key
    revokeMode = 'lost';
    submitRevoke.click();
    await vi.waitFor(() => {
      expect(root.textContent).toContain('page.common.uncertain');
    });
    expect(subject.disabled).toBe(true);
    const lostKey = revokeKeys.at(-1);
    expect(lostKey).toBeTruthy();

    revokeMode = 'true';
    const retryBtn = [...root.querySelectorAll('button')].find((b) =>
      b.textContent?.includes('page.common.retryOriginal'),
    );
    expect(retryBtn).toBeDefined();
    retryBtn?.click();
    await vi.waitFor(() => {
      expect(root.textContent).toContain('page.sessionPolicy.revoked');
    });
    expect(revokeKeys.at(-1)).toBe(lostKey);
  });
});
