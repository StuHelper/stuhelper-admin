import { createApp, h, nextTick } from 'vue';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { createSessionStore, sessionKey } from '#/shared/session';

import example from '../../../../../contracts/storage-operations.example.json';
import { StorageError } from './api';
import { useStorage } from './useStorage';

const disposals: (() => void)[] = [];
afterEach(() => { for (const dispose of disposals.splice(0)) dispose(); vi.useRealTimers(); });
async function settle() { for (let n = 0; n < 8; n++) await Promise.resolve(); await nextTick(); }
function mount(
  api: Parameters<typeof useStorage>[0],
  session?: ReturnType<typeof createSessionStore>,
) {
  let model: ReturnType<typeof useStorage> | undefined;
  const app = createApp({ setup() { model = useStorage(api); return () => h('div'); } });
  if (session) app.provide(sessionKey, session);
  const container = document.createElement('div');
  app.mount(container);
  disposals.push(() => app.unmount());
  if (!model) throw new Error('fixture setup failed');
  return model;
}
describe('storage interaction state', () => {
  it('keeps the same body and key after an uncertain response and blocks duplicates', async () => {
    const execute = vi.fn().mockRejectedValueOnce(new StorageError('network', true)).mockResolvedValue(undefined);
    const read = vi.fn().mockResolvedValue(example);
    const model = mount({ read, execute }); await settle();
    model.prepareInstance(example.instances[0]!, 'pause');
    await model.submit();
    const original = execute.mock.calls[0]![0];
    model.cancel(); model.prepareJob(example.failures[0]!);
    expect(model.pending.value?.kind).toBe('instance');
    expect(model.uncertain.value).toBe(true);
    await model.submit();
    expect(execute.mock.calls[1]![0]).toEqual(original);
    expect(model.pending.value).toBeNull();
    expect(model.data.value).toEqual(example);
    expect(model.completed.value).toBe(true);
  });
  it('clears protected data on permission revocation', async () => {
    const model = mount({ read: vi.fn().mockResolvedValue(example), execute: vi.fn().mockRejectedValue(new StorageError('forbidden')) }); await settle();
    model.prepareJob(example.failures[0]!); await model.submit();
    expect(model.data.value).toBeNull(); expect(model.pending.value).toBeNull(); expect(model.error.value).toBe('forbidden');
  });
  it('ignores old reads after a newer rejection', async () => {
    let finish: ((value: typeof example) => void) | undefined;
    const read = vi.fn().mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; })).mockRejectedValueOnce(new StorageError('unauthenticated'));
    const model = mount({ read, execute: vi.fn() });
    await model.reload(); finish?.(example); await settle();
    expect(model.data.value).toBeNull(); expect(model.error.value).toBe('unauthenticated');
  });
  it('rejects parallel submits and clears state when unmounted', async () => {
    let finish: (() => void) | undefined;
    const execute = vi.fn().mockImplementation(() => new Promise<void>((resolve) => { finish = resolve; }));
    const model = mount({ read: vi.fn().mockResolvedValue(example), execute }); await settle();
    model.prepareJob(example.failures[0]!);
    const first = model.submit(); await model.submit();
    expect(execute).toHaveBeenCalledTimes(1);
    disposals.pop()?.(); finish?.(); await first;
    expect(model.data.value).toBeNull(); expect(model.pending.value).toBeNull();
  });

  it('invalidates the shared session store when storage returns unauthenticated (A-19)', async () => {
    const session = createSessionStore(async () =>
      Response.json({
        administrator: true,
        authenticated: true,
        content_school_id: 'school',
        csrf_token: 'a'.repeat(43),
        expires_at: '2030-01-01T00:00:00Z',
        phone_bound: false,
        profile: {
          bio: '',
          group_card_consent: {
            department: false,
            gender: false,
            grade: false,
            name: false,
            nickname: false,
            school: false,
            student_id: false,
          },
          id: '00000000-0000-4000-8000-000000000001',
          nickname: 'Admin',
          nickname_required: false,
          revision: 1,
          visibility: {
            badge: true,
            department: true,
            grade: false,
            resources: true,
            reviews: true,
            school: true,
          },
        },
      }),
    );
    await session.reload();
    expect(session.state.value).toBe('member');

    mount(
      {
        execute: vi.fn(),
        read: vi.fn().mockRejectedValue(new StorageError('unauthenticated')),
      },
      session,
    );
    await settle();
    expect(session.state.value).toBe('guest');
  });
});
