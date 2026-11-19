import { createApp, h, nextTick } from 'vue';

import { describe, expect, it, vi } from 'vitest';

import { accountJumpKey, createAccountJumpStore } from '#/shared/account-jump';

import AccountJumpBar from './AccountJumpBar.vue';

const push = vi.hoisted(() => vi.fn());
vi.mock('vue-router', () => ({ useRouter: () => ({ push, currentRoute: { value: { path: '/qq-binding' } } }) }));
vi.mock('@vben/locales', () => ({ useI18n: () => ({ t: (key: string) => key }) }));
vi.mock('#/shared/capabilities', () => ({ useCapabilities: () => ({ has: () => true }) }));

describe('account navigation', () => {
  it('removes a cancelled prefill without dropping a newer navigation', async () => {
    const store = createAccountJumpStore();
    const root = document.createElement('div');
    const app = createApp({ render: () => h(AccountJumpBar, { account: 'user-1' }) });
    app.provide(accountJumpKey, store);
    app.mount(root);
    try {
      const jump = [...root.querySelectorAll('button')].find(button => button.textContent?.includes('toQqBinding'))!;
      push.mockResolvedValueOnce({ type: 4 });
      jump.click();
      await nextTick();
      expect(store.consume('qqBinding')).toBeUndefined();

      let cancelFirst!: (failure: { type: number }) => void;
      push.mockImplementationOnce(() => new Promise(resolve => { cancelFirst = resolve; }));
      push.mockResolvedValueOnce(undefined);
      jump.click();
      jump.click();
      cancelFirst({ type: 8 });
      await nextTick();
      expect(store.consume('qqBinding')?.subject).toBe('user-1');
    } finally {
      app.unmount();
    }
  });
});
