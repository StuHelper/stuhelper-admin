import { createApp, h, nextTick, ref } from 'vue';

import { afterEach, expect, it, vi } from 'vitest';

import { ApiError } from '#/shared/api/errors';

import TeacherSitesView from './TeacherSitesView.vue';

const mock = vi.hoisted(() => ({ json: vi.fn() }));
vi.mock('#/shared/session', () => ({ useHttp: () => ({ json: mock.json }) }));
vi.mock('@vben/locales', () => ({ useI18n: () => ({ t: (key: string, values?: Record<string, unknown>) => (values ? `${key} ${JSON.stringify(values)}` : key) }) }));
vi.mock('#/shared/format', () => ({ useFormat: () => ({ dateTime: (value: string) => value, number: String }) }));
vi.mock('#/shared/ui/messages', () => ({ useErrorText: () => (value: string) => `error:${value}` }));
vi.mock('#/shared/ui/AdminPage.vue', () => ({ default: { template: '<div><slot /></div>' } }));
vi.mock('./campus', () => ({ useCampusId: () => ref('school') }));

const counts = { teaching: 6218, official: 2223, both: 1918, eligible: 6523 };
const run = (status: string) => ({ id: 'run-1', school_id: 'school', mode: 'incremental', trigger: 'scheduled', status, requested_at: '2026-11-15T00:00:00Z', started_at: '2026-11-15T00:00:01Z', finished_at: status === 'succeeded' ? '2026-11-15T00:01:00Z' : null, deadline_at: '2026-11-15T01:00:00Z', duration_ms: 57_000, requests: 34, site_count: 3134, counts, failure_reason: '' });
const page = (reason: string) => ({ items: [{ site_id: `site-${reason || 'all'}`, name: 'Synthetic Teacher', unit: 'Synthetic College', reason: reason || 'unit_mismatch', candidate_count: 2 }], total: 1, reason_counts: { unit_mismatch: 451, ambiguous_catalog: 318 }, next: '', revision: 1, observed_at: '2026-11-15T00:00:00Z' });
const cleanups: (() => void)[] = [];
afterEach(() => { for (const clean of cleanups.splice(0)) clean(); mock.json.mockReset(); });
async function settle() { for (let i = 0; i < 3; i++) { await Promise.resolve(); await nextTick(); await new Promise((resolve) => setTimeout(resolve, 0)); } }
async function mount() {
  const root = document.createElement('div'); document.body.append(root);
  const app = createApp({ render: () => h(TeacherSitesView) });
  app.mount(root); await settle();
  cleanups.push(() => { app.unmount(); root.remove(); });
  return root;
}
const button = (root: HTMLElement, text: string) => [...root.querySelectorAll('button')].find((value) => value.textContent?.includes(text));

it('shows mark counts, the latest run and unmatched homepages without staff numbers', async () => {
  mock.json.mockImplementation(async (path: string) => (path.endsWith('/refresh') ? { latest: run('succeeded'), counts } : page('')));
  const root = await mount();
  expect(root.textContent?.replaceAll(',', '')).toContain('6523');
  expect(root.textContent).toContain('page.teacherSites.status.succeeded');
  expect(root.textContent).toContain('3134');
  expect(root.textContent).toContain('Synthetic Teacher');
  expect(root.textContent).toContain('page.teacherSites.reasons.unit_mismatch');
  const paths = mock.json.mock.calls.map(([path]) => path);
  expect(paths).toContain('/api/v1/catalog/admin/schools/school/teacher-sites/refresh');
  expect(paths).toContain('/api/v1/catalog/admin/schools/school/teacher-sites/unmatched');
});

it('starts one incremental refresh with an idempotency key and reports a running refresh', async () => {
  const posts: { body: unknown; key: string }[] = [];
  mock.json.mockImplementation(async (path: string, _validate: unknown, options?: { body?: unknown; key?: string; method?: string }) => {
    if (options?.method === 'POST') { posts.push({ body: options.body, key: options.key ?? '' }); throw new ApiError('conflict', false, 409); }
    return path.endsWith('/refresh') ? { latest: run('succeeded'), counts } : page('');
  });
  const root = await mount();
  button(root, 'page.teacherSites.runIncremental')!.click(); await settle();
  expect(posts).toHaveLength(1);
  expect(posts[0]!.body).toEqual({ mode: 'incremental' });
  expect(posts[0]!.key).not.toBe('');
  expect(root.textContent).toContain('page.teacherSites.alreadyRunning');
});

it('disables both refresh buttons while a run is queued or running', async () => {
  mock.json.mockImplementation(async (path: string) => (path.endsWith('/refresh') ? { latest: run('running'), counts } : page('')));
  const root = await mount();
  expect(button(root, 'page.teacherSites.runIncremental')!.disabled).toBe(true);
  expect(button(root, 'page.teacherSites.runFull')!.disabled).toBe(true);
});
