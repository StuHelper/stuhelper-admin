import { createApp, h, nextTick } from 'vue';
import { createMemoryHistory, createRouter, RouterView } from 'vue-router';

import { afterEach, expect, it, vi } from 'vitest';

import { ApiError } from '#/shared/api/errors';

import FeedbackView from './FeedbackView.vue';

const mock = vi.hoisted(() => ({ json: vi.fn() }));
vi.mock('#/shared/session', () => ({ useHttp: () => ({ json: mock.json }) }));
vi.mock('@vben/locales', () => ({ useI18n: () => ({ t: (key: string) => key }) }));
vi.mock('#/shared/format', () => ({ useFormat: () => ({ dateTime: (value: string) => value, bytes: String }) }));
vi.mock('#/shared/ui/messages', () => ({ useErrorText: () => (value: string) => value }));
vi.mock('#/shared/ui/AdminPage.vue', () => ({ default: { template: '<div><slot /></div>' } }));

const message = () => ({ id: 'case', sender: 'sender@example.test', subject: 'Synthetic', body: 'Evidence', authentication_results: '', suspicious: true, state: 'new', assignee: '', note: '', revision: 1, received_at: '2026-11-15T00:00:00Z', closed_at: null, attachments: [], replies: [] });
const cleanups: (() => void)[] = [];
afterEach(() => { for (const clean of cleanups.splice(0)) clean(); mock.json.mockReset(); vi.restoreAllMocks(); });
async function settle() { await Promise.resolve(); await nextTick(); await new Promise((resolve) => setTimeout(resolve, 0)); await nextTick(); }
async function mount() {
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/feedback', component: FeedbackView }, { path: '/', component: { template: '<p>Home</p>' } }] });
  const root = document.createElement('div'); document.body.append(root);
  const app = createApp({ render: () => h(RouterView) }); app.use(router);
  await router.push('/feedback'); app.mount(root); await settle();
  const button = [...root.querySelectorAll('button')].find((value) => value.textContent?.includes('Synthetic'));
  if (!button) throw new Error('Message button missing');
  button.click(); await settle();
  cleanups.push(() => { app.unmount(); root.remove(); });
  return { root, router };
}
async function input(element: HTMLTextAreaElement, value: string) { element.value = value; element.dispatchEvent(new Event('input', { bubbles: true })); await settle(); }
async function submit(form: HTMLFormElement) { form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); await settle(); }

it('protects route changes and refresh while drafts or unknown replies exist', async () => {
  mock.json.mockImplementation(async (path, _validate, options) => {
    if (options?.method === 'POST') throw new ApiError('network', true);
    return path.endsWith('/case') ? message() : { items: [message()], next_cursor: '' };
  });
  const confirm = vi.fn(() => false);
  Object.defineProperty(window, 'confirm', { value: confirm, configurable: true });
  cleanups.push(() => { Reflect.deleteProperty(window, 'confirm'); });
  const { root, router } = await mount();
  const [note, reply] = root.querySelectorAll<HTMLTextAreaElement>('textarea');
  await input(note!, 'Draft note');
  await router.push('/');
  expect(router.currentRoute.value.path).toBe('/feedback');
  expect(confirm).toHaveBeenLastCalledWith('page.common.leaveUnsaved');
  await input(note!, '');
  await input(reply!, 'Reply retained');
  await submit(root.querySelectorAll<HTMLFormElement>('form')[1]!);
  await router.push('/');
  expect(router.currentRoute.value.path).toBe('/feedback');
  expect(confirm).toHaveBeenLastCalledWith('page.common.leaveUncertain');
  expect(reply!.value).toBe('Reply retained');
  expect(reply!.disabled).toBe(true);
  const event = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(true);
});

it('retains the edit revision when replies refresh a concurrent operator change', async () => {
  const current = message(); const updates: unknown[] = [];
  mock.json.mockImplementation(async (path, _validate, options) => {
    if (options?.method === 'POST') {
      current.revision = 3; current.note = 'Other operator';
      return { id: 'reply', actor: 'operator', body: options.body.body, state: 'sent', created_at: current.received_at };
    }
    if (options?.method === 'PATCH') { updates.push(options.body); throw new ApiError('conflict', false, 409); }
    return path.endsWith('/case') ? structuredClone(current) : { items: [structuredClone(current)], next_cursor: '' };
  });
  const { root } = await mount();
  const [note, reply] = root.querySelectorAll<HTMLTextAreaElement>('textarea');
  await input(note!, 'My draft'); await input(reply!, 'Response');
  await submit(root.querySelectorAll<HTMLFormElement>('form')[1]!);
  expect(note!.value).toBe('My draft');
  await submit(root.querySelectorAll<HTMLFormElement>('form')[0]!);
  expect(updates).toEqual([{ revision: 1, state: 'new', note: 'My draft' }]);
  expect(current.note).toBe('Other operator');
});

it('unlocks a known rejected reply and retains its draft with a new request key', async () => {
  const keys: string[] = [];
  mock.json.mockImplementation(async (path, _validate, options) => {
    if (options?.method === 'POST') { keys.push(options.key); throw new ApiError('invalid_input', false, 400); }
    return path.endsWith('/case') ? message() : { items: [message()], next_cursor: '' };
  });
  const { root } = await mount();
  const reply = root.querySelectorAll<HTMLTextAreaElement>('textarea')[1]!;
  await input(reply, 'Original draft');
  await submit(root.querySelectorAll<HTMLFormElement>('form')[1]!);
  expect(reply.disabled).toBe(false); expect(reply.value).toBe('Original draft');
  await input(reply, 'Corrected draft');
  await submit(root.querySelectorAll<HTMLFormElement>('form')[1]!);
  expect(keys).toHaveLength(2); expect(keys[1]).not.toBe(keys[0]);
});
