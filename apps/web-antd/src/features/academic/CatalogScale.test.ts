// @vitest-environment happy-dom
import { createApp, h, ref } from 'vue';

import { afterEach, describe, expect, it, vi } from 'vitest';

import DirectoriesView from '#/features/resources/DirectoriesView.vue';
import { createSessionStore, sessionKey } from '#/shared/session';

import CatalogView from './CatalogView.vue';

vi.mock('vue-router', () => ({
  onBeforeRouteLeave: () => {},
  onBeforeRouteUpdate: () => {},
}));

vi.mock('@vben/locales', () => ({
  useI18n: () => ({
    locale: ref('zh-CN'),
    t: (key: string) => key,
    te: () => true,
  }),
}));

vi.mock('#/shared/format', () => ({
  useFormat: () => ({
    value: {
      dateTime: (v: string) => v,
      list: (v: string[]) => v.join(', '),
      number: String,
    },
    dateTime: (v: string) => v,
    list: (v: string[]) => v.join(', '),
    number: String,
  }),
}));

vi.mock('./campus', () => ({
  useCampusId: () => ref('buaa'),
}));

const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const clean of cleanups.splice(0)) clean();
  vi.restoreAllMocks();
});

const makeCourse = (id: string, name: string) => ({
  aliases: [],
  canonical_id: id,
  code: id.toUpperCase(),
  credits: 3,
  id,
  kind: 'course',
  name,
  revision: 1,
  school_id: 'buaa',
  updated_at: '2026-11-18T00:00:00Z',
});

describe('CatalogView and DirectoriesView >1000 courses scale (A-06)', () => {
  it('resolves directory course names via batch lookup and searches >1000 merge targets without 10-page options() failure', async () => {
    const mode = ref<'catalog' | 'directories'>('directories');
    const objectQueries: Array<Record<string, string>> = [];

    // Simulate a school with 2500 courses: any paged query always returns `next` unless exhausted past 2500.
    const fetcher: typeof fetch = async (input) => {
      const url = new URL(String(input), 'http://localhost');
      const path = url.pathname;
      if (path === '/api/v1/resources/directories') {
        return Response.json({
          items: [
            {
              course_id: 'course-1999',
              enabled: true,
              id: 'dir-1',
              names: { 'zh-CN': '高等数学讲义' },
              parent_id: '',
              revision: 1,
              school_id: 'buaa',
            },
          ],
          next_cursor: '',
        });
      }
      if (path === '/api/v1/catalog/objects/lookup') {
        const ids = (url.searchParams.get('ids') ?? '').split(',').filter(Boolean);
        return Response.json({
          items: ids.map((id) =>
            makeCourse(
              id,
              id === 'course-1999' ? '高等数学（第1999门课）' : `课程-${id}`,
            ),
          ),
          missing_ids: [],
        });
      }
      if (
        path === '/api/v1/catalog/objects' ||
        path === '/api/v1/catalog/admin/objects'
      ) {
        const params = Object.fromEntries(url.searchParams.entries());
        objectQueries.push(params);
        if (params.kind !== 'course') {
          return Response.json({ items: [], next: '' });
        }
        const limit = Number(params.limit ?? '20');
        const q = params.q ?? '';
        if (q === '线性代数') {
          return Response.json({
            items: [makeCourse('course-2048', '线性代数B')],
            next: '',
          });
        }
        const start = params.after ? Number(params.after.replace('course-', '')) + 1 : 1;
        const items = Array.from({ length: limit }, (_, idx) =>
          makeCourse(`course-${start + idx}`, `课程 ${start + idx}`),
        );
        const last = start + limit - 1;
        return Response.json({
          items,
          next: last < 2500 ? `course-${last}` : '',
        });
      }
      if (path === '/api/v1/catalog/admin/objects/course-1/summary') {
        return Response.json({
          categories: [],
          course_count: 0,
          department: null,
          natures: [],
          object: makeCourse('course-1', '课程 1'),
          offering_count: 1,
          school: {
            aliases: [],
            credits: null,
            id: 'buaa',
            kind: 'school',
            name: 'BUAA',
            revision: 1,
            school_id: 'buaa',
            updated_at: '2026-11-18T00:00:00Z',
          },
          teacher_count: 1,
        });
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
        return () =>
          mode.value === 'directories' ? h(DirectoriesView) : h(CatalogView);
      },
    });
    app.provide(sessionKey, store);
    app.mount(root);
    cleanups.push(() => {
      app.unmount();
      root.remove();
    });

    // DirectoriesView resolves course-1999 name via lookup instead of failing after 1000 options()
    await vi.waitFor(() => {
      expect(root.textContent).toContain('高等数学（第1999门课）');
    });
    expect(
      objectQueries.filter((q) => q.kind === 'course' && q.limit === '100'),
    ).toHaveLength(0);

    // Switch to CatalogView: opening course-1 and switching to lifecycle tab loads paged merge targets
    mode.value = 'catalog';
    await vi.waitFor(() => {
      expect(root.textContent).toContain('课程 1');
    });
    const editBtn = [...root.querySelectorAll<HTMLButtonElement>('button')].find(
      (b) => b.textContent?.includes('page.common.edit'),
    );
    editBtn?.click();
    await vi.waitFor(() => {
      expect(document.body.textContent).toContain('page.catalog.lifecycle');
    });
    const lifecycleTab = [
      ...document.querySelectorAll<HTMLElement>('[role="tab"]'),
    ].find((el) => el.textContent?.includes('page.catalog.lifecycle'));
    lifecycleTab?.click();
    await vi.waitFor(() => {
      expect(
        document.querySelector('#catalogview-field-8'),
      ).not.toBeNull();
    });
    // Must not issue 10 serial limit=100 course requests
    expect(
      objectQueries.filter((q) => q.kind === 'course' && q.limit === '100'),
    ).toHaveLength(0);
  });
});
