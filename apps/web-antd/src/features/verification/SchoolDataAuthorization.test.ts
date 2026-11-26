// @vitest-environment happy-dom
import { createApp, h, ref } from 'vue';

import { afterEach, expect, it, vi } from 'vitest';

import { hostFetchKey } from '#/shared/api/transport';

import SchoolDataAuthorization from './SchoolDataAuthorization.vue';

vi.mock('@vben/locales', () => ({
  useI18n: () => ({
    t: (key: string, args?: { season: string; year: string }) =>
      args ? `${args.year} ${args.season}` : key,
    te: () => true,
  }),
}));
vi.mock('#/shared/format', () => ({
  useFormat: () => ({ value: { number: String } }),
}));

let cleanup: (() => void) | undefined;
afterEach(() => cleanup?.());

function mountAuthorization(fetcher: typeof fetch) {
  const credentialId = ref('credential-a');
  const root = document.createElement('div');
  document.body.append(root);
  const app = createApp({
    render: () => h(SchoolDataAuthorization, { credentialId: credentialId.value }),
  });
  app.provide(hostFetchKey, fetcher);
  app.mount(root);
  cleanup = () => {
    app.unmount();
    root.remove();
  };
  return { credentialId, root };
}

it('shows the retained term and removes the previous status on permission denial', async () => {
  const calls: string[] = [];
  const { credentialId, root } = mountAuthorization(async (input) => {
    const path = new URL(String(input), 'http://localhost').pathname;
    calls.push(path);
    if (path.endsWith('/credential-b/school-data')) {
      return Response.json({ code: 'permission_denied' }, { status: 403 });
    }
    return Response.json({
      authorized_through: { id: 'term-autumn', season: 'autumn', year: 2026 },
      state: 'historical',
    });
  });
  await vi.waitFor(() => expect(root.textContent).toContain('2026 page.verification.schoolData.seasons.autumn'));
  expect(root.textContent).toContain('page.verification.schoolData.states.historical');
  credentialId.value = 'credential-b';
  await vi.waitFor(() => expect(root.textContent?.trim()).toBe(''));
  expect(calls).toEqual([
    '/api/v1/admin/verification/credentials/credential-a/school-data',
    '/api/v1/admin/verification/credentials/credential-b/school-data',
  ]);
});
