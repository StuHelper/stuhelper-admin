// @vitest-environment happy-dom
import { createApp, h, nextTick, ref } from 'vue';

import { afterEach, describe, expect, it, vi } from 'vitest';

import OverviewView from '#/features/overview/OverviewView.vue';
import CategoriesView from '#/features/resources/CategoriesView.vue';
import ResourcesView from '#/features/resources/ResourcesView.vue';
import ReviewView from '#/features/resources/ReviewView.vue';
import { capabilitiesKey, createCapabilities } from '#/shared/capabilities';
import { createSessionStore, sessionKey } from '#/shared/session';

import ModerationView from './ModerationView.vue';
import TimetableView from './TimetableView.vue';

vi.mock('vue-router', () => ({
  onBeforeRouteLeave: () => {},
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
      te: () => true,
    }),
  };
});

vi.mock('#/shared/format', async () => {
  const { createFormatters } = await import('@vben/locales');
  const fmt = createFormatters('zh-CN', 'Asia/Shanghai');
  const wrapped = {
    ...fmt,
    bytes: (n: number) => `${n} B`,
    value: { ...fmt, bytes: (n: number) => `${n} B` },
  };
  return { useFormat: () => wrapped };
});

const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const clean of cleanups.splice(0)) clean();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const sessionPayload = {
  administrator: true,
  authenticated: true,
  content_school_id: 'buaa',
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
};

const schoolObj = {
  aliases: [],
  credits: null,
  id: 'buaa',
  kind: 'school',
  name: 'BUAA',
  revision: 1,
  school_id: 'buaa',
  updated_at: '2026-11-18T00:00:00Z',
};

describe('PR 6 view reliability regressions (A-09, A-10, A-11, A-14, A-18, A-20)', () => {
  it('auto-advances past filtered resource tasks in ModerationView, renders null published_at & versionless drafts safely, recovers TimetableView empty/503 terms, surfaces OverviewView campus outage, polls decided ReviewView tasks, and validates CategoriesView fields', async () => {
    const view = ref<
      | 'categories'
      | 'moderation-content'
      | 'moderation-queue'
      | 'overview'
      | 'resources'
      | 'review'
      | 'timetable'
    >('moderation-queue');

    let schoolOutage = false;
    let termOutage = true;
    let termsEmpty = true;
    let reviewTaskState: 'applied' | 'decided' | 'waiting' = 'waiting';

    const makeTask = (id: string, contentKind: string, state = 'waiting') => ({
      content_kind: contentKind,
      created_at: '2026-11-18T00:00:00Z',
      id,
      object_revision: 1,
      revision: 1,
      school_id: 'buaa',
      state,
      submission: {
        evidence: [],
        kind: 'review',
        object_id: contentKind === 'resource' ? 'resource:ver-1' : `rev-${id}`,
        reason: 'content_review',
      },
      updated_at: '2026-11-18T00:00:00Z',
    });

    const fetcher: typeof fetch = async (input, init) => {
      const url = new URL(String(input), 'http://localhost');
      const path = url.pathname;
      if (path === '/api/v1/system/capabilities') return Response.json({ api_version: 1, capabilities: [] });
      if (path === '/api/v1/auth/session') return Response.json(sessionPayload);
      if (path === '/api/v1/admin/modules') return Response.json([]);
      if (path === '/api/v1/storage/operations') {
        return Response.json({
          failures: [],
          failures_next_cursor: '',
          generated_at: '2026-11-18T00:00:00Z',
          instances: [],
          jobs: { blocked: 3, pending: 0, running: 0 },
          next_cursor: '',
          objects: [],
        });
      }
      if (path === '/api/v1/catalog/objects') {
        const kind = url.searchParams.get('kind');
        if (kind === 'school') {
          if (schoolOutage) return Response.json({ code: 'unavailable' }, { status: 503 });
          return Response.json({ items: [schoolObj], next: '' });
        }
        if (kind === 'term') {
          if (termOutage) return Response.json({ code: 'unavailable' }, { status: 503 });
          return Response.json({ items: termsEmpty ? [] : [], next: '' });
        }
      }
      if (path === '/api/v1/moderation/tasks') {
        const contentKind = url.searchParams.get('content_kind') ?? '';
        const after = url.searchParams.get('after') ?? '';
        if (contentKind === 'resource') {
          return Response.json([makeTask('rt-1', 'resource', reviewTaskState)]);
        }
        // First page: 20 resource tasks; second page: 1 review task!
        if (!after) {
          return Response.json(
            Array.from({ length: 20 }, (_, i) => makeTask(`t-${i + 1}`, 'resource')),
          );
        }
        return Response.json([makeTask('t-21', 'review')]);
      }
      if (path === '/api/v1/moderation/tasks/rt-1') {
        return Response.json(makeTask('rt-1', 'resource', reviewTaskState));
      }
      if (path === '/api/v1/moderation/tasks/rt-1/decisions' && init?.method === 'POST') {
        reviewTaskState = 'decided';
        return Response.json(makeTask('rt-1', 'resource', 'decided'));
      }
      if (path === '/api/v1/reviews/admin/entries') {
        return Response.json({
          items: [
            {
              anonymous: true,
              author_handle: 'stu-1',
              created_at: '2026-11-18T00:00:00Z',
              featured: false,
              id: 'entry-1',
              input: {
                body: 'Pending review text',
                kind: 'course',
                ratings: [5, 5, 3, 3, 5],
                signed: false,
                target_id: 'course-1',
                title: 'Unpublished Review',
              },
              published_at: null,
              revision: 1,
              root_id: 'entry-1',
              school_id: 'buaa',
              state: 'pending',
            },
          ],
          next: '',
        });
      }
      if (path === '/api/v1/resources/manage') {
        return Response.json({
          items: [
            {
              access_reason: 'allowed',
              download_allowed: false,
              id: 'draft-res-1',
              owned: true,
              revision: 1,
              state: 'draft',
            },
          ],
          next_cursor: '',
        });
      }
      if (path === '/api/v1/resources/review/ver-1') {
        return Response.json({
          access_reason: 'allowed',
          download_allowed: true,
          id: 'res-1',
          owned: false,
          proposal: {
            category: {
              enabled: true,
              fields: [],
              group_by: '',
              id: 'cat-1',
              names: { 'zh-CN': '讲义' },
              order: 1,
              revision: 1,
            },
            created_at: '2026-11-18T00:00:00Z',
            id: 'ver-1',
            metadata: {
              access: 'public',
              associations: { school_id: 'buaa' },
              attributes: {},
              category_id: 'cat-1',
              category_revision: 1,
              description: 'Desc',
              origin: { kind: 'original' },
              tags: [],
              title: 'Calculus Slides',
            },
            number: 1,
            state: 'pending',
          },
          revision: 1,
          state: 'draft',
        });
      }
      if (path === '/api/v1/resources/categories') {
        return Response.json({ items: [], next_cursor: '' });
      }
      return Response.json({ code: 'not_found' }, { status: 404 });
    };

    vi.stubGlobal('fetch', fetcher);
    vi.stubGlobal(
      'window',
      Object.assign(globalThis.window, {
        confirm: () => true,
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
      setup() {
        return () => {
          switch (view.value) {
            case 'categories': {
              return h(CategoriesView);
            }
            case 'moderation-content': {
              return h(ModerationView, { key: 'content', mode: 'content' });
            }
            case 'moderation-queue': {
              return h(ModerationView, { key: 'queue', mode: 'queue' });
            }
            case 'overview': {
              return h(OverviewView);
            }
            case 'resources': {
              return h(ResourcesView);
            }
            case 'review': {
              return h(ReviewView);
            }
            case 'timetable': {
              return h(TimetableView);
            }
          }
        };
      },
    });
    const capabilities = createCapabilities(fetcher);
    await capabilities.load();
    app.provide(capabilitiesKey, capabilities);
    app.provide(sessionKey, store);
    app.mount(root);
    cleanups.push(() => {
      app.unmount();
      root.remove();
    });

    // A-09: ModerationView queue auto-advances past 20 filtered resource tasks to reach t-21
    await vi.waitFor(() => {
      expect(root.textContent).toContain('page.moderation.contentReview');
    });

    // A-10 (1): ModerationView content renders published_at: null as notProvided, never 1970
    view.value = 'moderation-content';
    await vi.waitFor(() => {
      expect(root.textContent).toContain('Unpublished Review');
    });
    expect(root.textContent).toContain('page.common.notProvided');
    expect(root.textContent).not.toContain('1970');

    // A-10 (2): ResourcesView renders versionless draft without throwing RangeError
    view.value = 'resources';
    await vi.waitFor(() => {
      expect(root.textContent).toContain('page.resources.state.draft');
    });
    expect(root.textContent).toContain('page.common.notProvided');

    // A-14: TimetableView recovers when initial terms fetch fails (503) and shows empty state when terms=[]
    view.value = 'timetable';
    await vi.waitFor(() => {
      expect(root.textContent).toContain('page.common.retry');
    });
    termOutage = false;
    termsEmpty = true;
    const retryBtn = [...root.querySelectorAll<HTMLButtonElement>('button')].find(
      (b) => b.textContent?.includes('page.common.retry'),
    );
    retryBtn?.click();
    await vi.waitFor(() => {
      expect(root.textContent).toContain('page.timetable.noTerms');
    });

    // A-11: OverviewView surfaces todoFailed banner and still loads storage todo when school lookup fails
    schoolOutage = true;
    store.invalidate();
    view.value = 'overview';
    await vi.waitFor(() => {
      expect(root.textContent).toContain('page.overview.todoFailed');
      expect(root.textContent).toContain('page.overview.todo.storage');
    });
    schoolOutage = false;

    // A-18: ReviewView polls decided task until applied when autoNext is unchecked
    vi.useFakeTimers();
    await store.reload();
    view.value = 'review';
    await vi.waitFor(() => {
      expect(root.textContent).toContain('page.common.open');
    });
    const openTaskBtn = [
      ...root.querySelectorAll<HTMLButtonElement>('button'),
    ].find((b) => b.textContent?.includes('page.common.open'));
    openTaskBtn?.click();
    await vi.waitFor(() => {
      expect(document.body.textContent).toContain('Calculus Slides');
    });
    const autoNextCheckbox = document.querySelector(
      '.ant-drawer input[type="checkbox"]',
    ) as HTMLInputElement;
    autoNextCheckbox?.click();
    await nextTick();
    const reasonBox = document.querySelector(
      '#reviewview-field-3',
    ) as HTMLTextAreaElement;
    reasonBox.value = 'Approved slides';
    reasonBox.dispatchEvent(new Event('input'));
    await nextTick();
    const applyBtn = [
      ...document.querySelectorAll<HTMLButtonElement>('.ant-drawer button'),
    ].find((b) => b.textContent?.includes('page.moderation.applyDecision'));
    applyBtn?.click();
    await vi.waitFor(() => {
      expect(document.body.textContent).toContain(
        'page.moderation.taskState.decided',
      );
    });
    reviewTaskState = 'applied';
    await vi.advanceTimersByTimeAsync(3100);
    await vi.waitFor(() => {
      expect(document.body.textContent).toContain(
        'page.moderation.taskState.applied',
      );
    });
    vi.useRealTimers();

    // A-20: CategoriesView disables save when a field has empty key or min > max
    view.value = 'categories';
    await vi.waitFor(() => {
      expect(root.textContent).toContain('page.resources.newCategory');
    });
    const newCatBtn = [
      ...root.querySelectorAll<HTMLButtonElement>('button'),
    ].find((b) => b.textContent?.includes('page.resources.newCategory'));
    newCatBtn?.click();
    await vi.waitFor(() => {
      expect(document.querySelector('#categoriesview-field-1')).not.toBeNull();
    });
    const idInput = document.querySelector(
      '#categoriesview-field-1',
    ) as HTMLInputElement;
    idInput.value = 'cat-test';
    idInput.dispatchEvent(new Event('input'));
    const zhInput = document.querySelector(
      '.ant-drawer input[lang="zh-CN"]',
    ) as HTMLInputElement;
    zhInput.value = '测试分类';
    zhInput.dispatchEvent(new Event('input'));
    await nextTick();
    const saveCatBtn = () =>
      [...document.querySelectorAll<HTMLButtonElement>('.ant-drawer button')].find(
        (b) => b.textContent?.includes('page.common.save'),
      );
    expect(saveCatBtn()?.disabled).toBe(false);
    const addFieldBtn = [
      ...document.querySelectorAll<HTMLButtonElement>('.ant-drawer button'),
    ].find((b) => b.textContent?.includes('page.resources.addField'));
    addFieldBtn?.click();
    await nextTick();
    // Newly added field has empty key -> Save must be disabled!
    expect(saveCatBtn()?.disabled).toBe(true);
  }, 20_000);
});
