// @vitest-environment happy-dom
import { createApp } from 'vue';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { hostFetchKey } from '#/shared/api/transport';

import VerificationView from './VerificationView.vue';

vi.mock('vue-router', () => ({ onBeforeRouteLeave: vi.fn(), onBeforeRouteUpdate: vi.fn() }));
vi.mock('@vben/locales', () => ({
  useI18n: () => ({
    t: (key: string, args?: { count?: string }) => args?.count === undefined ? key : key + ' ' + args.count,
    te: () => true,
  }),
}));
vi.mock('#/shared/format', () => ({
  useFormat: () => ({ value: { number: String }, number: String, list: (v: string[]) => v.join(', ') }),
}));

const schoolId = '4111010006';
const action = 'page.verification.cancelPending.action';
const cancelPath = '/api/v1/admin/verification/school-data/recheck/cancel';
let cleanup: (() => void) | undefined;
afterEach(() => { cleanup?.(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

async function openConfiguration(options: { affected?: number; cancelStatus?: number; configStatus?: number; id?: string; lostResponse?: boolean } = {}) {
  const id = options.id ?? schoolId;
  const school = {
    id, name: 'Test university', enabled: true, methods: ['manual_material_review'],
    notice_version: 'v1', opening_date: '2026-01-01', newcomer_days: 30, revision: 1,
    email_domain: 'example.edu', material_types: [],
  };
  const posts: RequestInit[] = [];
  let readConfig = false;
  const fetcher: typeof fetch = async (input, init) => {
    const path = new URL(String(input), 'http://localhost').pathname;
    if (init?.method === 'POST') {
      expect(path).toBe(cancelPath);
      posts.push(init);
      if (options.lostResponse && posts.length === 1) throw new TypeError('connection closed');
      return options.cancelStatus === 403
        ? Response.json({ code: 'verification_permission_denied' }, { status: 403 })
        : Response.json({ scheduled: options.affected ?? 3 });
    }
    if (path === '/api/v1/admin/verification/access') return Response.json({ allowed: true });
    if (path === '/api/v1/verification/schools') return Response.json([school]);
    if (path === '/api/v1/admin/verification/schools/' + id) {
      readConfig = true;
      if (options.configStatus === 404) return Response.json({ code: 'not_found' }, { status: 404 });
      return options.configStatus === 403
        ? Response.json({ code: 'verification_permission_denied' }, { status: 403 })
        : Response.json(school);
    }
    return Response.json([]);
  };
  const root = document.createElement('div');
  document.body.append(root);
  const app = createApp(VerificationView);
  app.provide(hostFetchKey, fetcher);
  app.mount(root);
  cleanup = () => { app.unmount(); root.remove(); };
  const tab = () => [...root.querySelectorAll<HTMLElement>('[role="tab"]')].find(el => el.textContent?.includes('page.verification.tabs.configuration'));
  await vi.waitFor(() => expect(tab()).toBeDefined());
  tab()?.click();
  await vi.waitFor(() => expect(readConfig).toBe(true));
  const button = () => [...root.querySelectorAll('button')].find(el => el.textContent?.includes(action));
  return { root, button, posts };
}

describe('cancel pending school data rechecks', () => {
  it.each([0, 3])('requires confirmation and reports the affected count %d', async (affected) => {
    const { root, button, posts } = await openConfiguration({ affected });
    await vi.waitFor(() => expect(button()).toBeDefined());
    const confirm = vi.fn().mockReturnValueOnce(false).mockReturnValueOnce(true);
    vi.stubGlobal('confirm', confirm);
    button()?.click();
    expect(confirm).toHaveBeenCalledWith('page.verification.cancelPending.confirm');
    expect(posts).toHaveLength(0);
    button()?.click();
    await vi.waitFor(() => expect(root.textContent).toContain('page.verification.cancelPending.result ' + affected));
    expect(posts).toHaveLength(1);
    expect(posts[0]?.body).toBeUndefined();
    expect(new Headers(posts[0]?.headers).get('Idempotency-Key')).toBeTruthy();
  });

  it.each([{ id: 'other' }, { configStatus: 403 }])('hides the action outside the authorized school configuration', async options => {
    const { button, posts } = await openConfiguration(options);
    expect(button()).toBeUndefined();
    expect(posts).toHaveLength(0);
  });

  it('keeps cancellation hidden when a missing configuration opens the create form', async () => {
    const { root, button, posts } = await openConfiguration({ configStatus: 404 });
    const save = () => [...root.querySelectorAll('button')].find(el => el.textContent?.includes('page.common.save'));
    await vi.waitFor(() => expect(save()?.disabled).toBe(false));
    expect(button()).toBeUndefined();
    expect(posts).toHaveLength(0);
  });

  it('retries a lost response with the same cancellation key', async () => {
    const { root, button, posts } = await openConfiguration({ lostResponse: true });
    await vi.waitFor(() => expect(button()).toBeDefined());
    vi.stubGlobal('confirm', vi.fn(() => true));
    button()?.click();
    const retry = () => [...root.querySelectorAll('button')].find(el => el.textContent?.includes('page.common.retryOriginal'));
    await vi.waitFor(() => expect(retry()).toBeDefined());
    expect(button()?.disabled).toBe(true);
    retry()?.click();
    await vi.waitFor(() => expect(root.textContent).toContain('page.verification.cancelPending.result 3'));
    expect(posts).toHaveLength(2);
    const keys = posts.map(post => new Headers(post.headers).get('Idempotency-Key'));
    expect(keys[0]).toBeTruthy();
    expect(keys[1]).toBe(keys[0]);
  });

  it('clears the action on server denial without reporting success', async () => {
    const { root, button, posts } = await openConfiguration({ cancelStatus: 403 });
    await vi.waitFor(() => expect(button()).toBeDefined());
    vi.stubGlobal('confirm', vi.fn(() => true));
    button()?.click();
    await vi.waitFor(() => expect(posts).toHaveLength(1));
    await vi.waitFor(() => expect(button()).toBeUndefined());
    expect(root.textContent).not.toContain('page.verification.cancelPending.result');
  });
});
