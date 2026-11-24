import type { Ref } from 'vue';

import { createApp, h, nextTick } from 'vue';
import { createMemoryHistory, createRouter, RouterView } from 'vue-router';

import { describe, expect, it, vi } from 'vitest';

import EventRetriesView from './EventRetriesView.vue';

const mock = vi.hoisted(() => ({
  json: vi.fn(), send: vi.fn(), reload: vi.fn(),
  session: undefined as Ref<{ event_retry_operator?: boolean }> | undefined,
}));
vi.mock('#/shared/session', async () => {
  const { ref } = await import('vue');
  mock.session = ref({});
  return {
    useHttp: () => ({ json: mock.json, send: mock.send }),
    useSession: () => ({ session: mock.session, reload: mock.reload }),
  };
});
vi.mock('@vben/locales', () => ({ useI18n: () => ({ t: (key: string) => key }) }));
vi.mock('#/shared/format', async () => {
  const { ref } = await import('vue');
  return { useFormat: () => ref({ dateTime: String, number: String }) };
});
vi.mock('#/shared/ui/messages', () => ({ useErrorText: () => String }));
vi.mock('#/shared/ui/AdminPage.vue', () => ({ default: { template: '<main><slot /></main>' } }));

async function settle() {
  await nextTick();
  await new Promise(resolve => setTimeout(resolve, 0));
  await nextTick();
}

describe('Manual event delivery', () => {
  it('requires an explicit grant and submits the observed generation once', async () => {
    const root = document.createElement('div');
    document.body.append(root);
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: '/', component: EventRetriesView }],
    });
    const app = createApp({ render: () => h(RouterView) });
    app.use(router);
    await router.push('/');
    const item = { id: 'fixture', attempts: 4, first_failure: '2026-10-01T00:00:00Z', last_error_code: 'timeout' };
    mock.json.mockResolvedValue({ items: [item] });
    mock.send.mockResolvedValue(new Response(null, { status: 204 }));
    try {
      app.mount(root);
      await settle();
      expect(mock.json).not.toHaveBeenCalled();
      mock.session!.value = { event_retry_operator: true };
      await settle();
      expect(root.textContent).toContain(item.id);
      const retry = [...root.querySelectorAll('button')].find(button => button.textContent?.trim() === 'page.common.retry');
      expect(retry).toBeDefined();
      retry!.click();
      await settle();
      expect(mock.send).toHaveBeenCalledTimes(1);
      expect(mock.send).toHaveBeenCalledWith('/api/v1/admin/event-retries', {
        method: 'POST', key: expect.any(String),
        body: { source: 'reviews', id: item.id, first_failure: item.first_failure },
      });
      mock.session!.value = {};
      await settle();
      expect(root.textContent).not.toContain(item.id);
    } finally {
      app.unmount();
      root.remove();
    }
  });
});
