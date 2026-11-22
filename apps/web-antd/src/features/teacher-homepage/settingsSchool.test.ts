import type { AllowlistField, AllowlistInput } from './settingsApi';

import { createApp, h, nextTick, ref } from 'vue';

import { afterEach, expect, it, vi } from 'vitest';

import { ApiError } from '#/shared/api/errors';

import SettingsSchool from './SettingsSchool.vue';

const mock = vi.hoisted(() => ({
  json: vi.fn(),
  reportMaintain: vi.fn(),
}));
vi.mock('#/shared/session', () => ({ useHttp: () => ({ json: mock.json }) }));
vi.mock('#/shared/composables/leave', () => ({ useLeaveGuard: vi.fn() }));
vi.mock('#/shared/format', () => ({ useFormat: () => ({ number: String }) }));
vi.mock('#/shared/ui/messages', () => ({ useErrorText: () => (code: string) => code }));
vi.mock('@vben/locales', () => ({ useI18n: () => ({ t: (key: string) => key }) }));
vi.mock('./access', () => ({
  useTeacherHomepageAccess: () => ({
    canMaintain: ref(true),
    reportMaintain: mock.reportMaintain,
  }),
}));

const counts = { teaching: 10, official: 13, both: 3, eligible: 21, verified_homepage: 6 };
let cleanup: (() => void) | undefined;
afterEach(() => {
  cleanup?.();
  cleanup = undefined;
  mock.json.mockReset();
  mock.reportMaintain.mockReset();
});

async function settle() {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await nextTick();
}

async function mount() {
  const root = document.createElement('div');
  document.body.append(root);
  const app = createApp({ render: () => h(SettingsSchool, { school: 'school' }) });
  app.mount(root);
  cleanup = () => {
    app.unmount();
    root.remove();
  };
  await settle();
  return root;
}

it('keeps separate teacher counts and retries an uncertain allowlist write with the original revision and key', async () => {
  let revision = 7;
  let fields: AllowlistField[] = [{ field: 'position' }];
  const attempts: { body: AllowlistInput; key: string }[] = [];
  mock.json.mockImplementation(async (
    path: string,
    _parse: unknown,
    options?: { body: AllowlistInput; key: string; method: string },
  ) => {
    if (options?.method === 'PUT') {
      attempts.push({ body: options.body, key: options.key });
      if (attempts.length === 1) throw new ApiError('timeout', true);
      fields = options.body.fields;
      revision++;
    }
    return path.endsWith('/homepage-counts') ? counts : { revision, fields };
  });

  const root = await mount();
  expect(root.textContent).toContain('page.teacherHomepage.settings.count.verified_homepage');
  const position = [...root.querySelectorAll('label')].find((label) =>
    label.textContent?.includes('page.teacherHomepage.fields.position'),
  );
  expect(position?.querySelector('input')?.checked).toBe(true);
  position!.querySelector('input')!.click();
  await settle();
  root.querySelector('form')!.dispatchEvent(new Event('submit', {
    bubbles: true,
    cancelable: true,
  }));
  await settle();

  expect(attempts).toHaveLength(1);
  expect(attempts[0]?.body).toEqual({ expected_revision: 7, fields: [] });
  expect(attempts[0]?.key).toBeTruthy();
  expect(root.querySelector<HTMLInputElement>('#teacher-homepage-allowlist-label')?.disabled).toBe(true);

  const retry = [...root.querySelectorAll('button')].find((button) =>
    button.textContent?.includes('page.common.retryOriginal'),
  );
  expect(retry).toBeDefined();
  retry!.click();
  await settle();

  expect(attempts).toEqual([attempts[0], attempts[0]]);
  expect(revision).toBe(8);
  expect(fields).toEqual([]);
  expect(root.textContent).toContain('page.common.saved');
});

it('clears both school settings reads when access is forbidden', async () => {
  let finishCounts: (value: typeof counts) => void = () => undefined;
  const lateCounts = new Promise<typeof counts>((resolve) => {
    finishCounts = resolve;
  });
  mock.json.mockImplementation(async (path: string) => {
    if (path.endsWith('/allowlist')) throw new ApiError('forbidden', false, 403);
    return lateCounts;
  });

  const root = await mount();
  expect(root.textContent).toContain('forbidden');
  finishCounts(counts);
  await settle();

  expect(mock.reportMaintain.mock.calls).toEqual([['school', false]]);
  expect(root.textContent).not.toContain('page.teacherHomepage.settings.count.verified_homepage');
  expect(root.querySelector('form')).toBeNull();
});
