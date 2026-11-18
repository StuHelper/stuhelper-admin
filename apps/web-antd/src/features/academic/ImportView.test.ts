// @vitest-environment happy-dom
import { createApp, ref } from 'vue';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { createSessionStore, sessionKey } from '#/shared/session';

import ImportView from './ImportView.vue';

vi.mock('vue-router', () => ({
  onBeforeRouteLeave: () => {},
  onBeforeRouteUpdate: () => {},
}));

vi.mock('@vben/locales', () => ({
  useI18n: () => ({
    locale: ref('zh-CN'),
    t: (key: string, values?: Record<string, unknown>) =>
      values ? `${key}:${JSON.stringify(values)}` : key,
    te: (key: string) =>
      key === 'page.errors.import_conflict' ||
      key.startsWith('page.catalog.kinds.') ||
      key.startsWith('page.catalog.importFields.') ||
      key.startsWith('page.catalog.changeState.'),
  }),
}));

vi.mock('#/shared/format', () => ({
  useFormat: () => ({
    value: {
      dateTime: (v: string) => v,
      list: (v: string[]) => v.join('、'),
      number: String,
    },
    dateTime: (v: string) => v,
    list: (v: string[]) => v.join('、'),
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

describe('ImportView >1000 items, localized preview and import_conflict handling (A-02, A-15, A-20)', () => {
  it('previews >1000 enrollments, localizes kind and changed fields, and clears stale preview on import_conflict', async () => {
    const fetcher: typeof fetch = async (input) => {
      const path = new URL(String(input), 'http://localhost').pathname;
      if (path === '/api/v1/catalog/imports/preview') {
        return Response.json({
          changes: [
            {
              fields: ['name', 'department_id'],
              id: 'course-1',
              kind: 'course',
              state: 'updated',
            },
          ],
          code: '',
          preview_token: 'tok-stale',
          valid: true,
        });
      }
      if (path === '/api/v1/catalog/imports/confirm') {
        return Response.json({ code: 'import_conflict' }, { status: 409 });
      }
      return Response.json({}, { status: 404 });
    };

    vi.stubGlobal('fetch', fetcher);
    vi.stubGlobal(
      'window',
      Object.assign(globalThis.window, {
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
    const app = createApp(ImportView);
    app.provide(sessionKey, store);
    app.mount(root);
    cleanups.push(() => {
      app.unmount();
      root.remove();
    });

    const enrollments = Array.from({ length: 1200 }, (_, i) => ({
      active: true,
      course_id: 'course-1',
      id: `enr-${i}`,
      school_id: 'buaa',
      subject: `stu-${i}`,
      teacher_ids: ['t-1'],
      term_id: '2026-fall',
    }));
    const file = new File(
      [
        JSON.stringify({
          enrollments,
          fetched_at: '2026-11-18T00:00:00Z',
          objects: [],
          revision: 1,
          school_id: 'buaa',
          source_id: 'jwxt',
        }),
      ],
      'import.json',
      { type: 'application/json' },
    );

    const fileInput = root.querySelector('#import-file') as HTMLInputElement;
    Object.defineProperty(fileInput, 'files', {
      configurable: true,
      value: [file],
    });
    fileInput.dispatchEvent(new Event('change'));

    await vi.waitFor(() => {
      expect(root.textContent).toContain('1200');
    });

    const previewBtn = [
      ...root.querySelectorAll<HTMLButtonElement>('button'),
    ].find((b) => b.textContent?.includes('page.catalog.previewImport'));
    previewBtn?.click();

    await vi.waitFor(() => {
      expect(root.textContent).toContain('page.catalog.kinds.course');
      expect(root.textContent).toContain(
        'page.catalog.importFields.name、page.catalog.importFields.department_id',
      );
    });

    const confirmBtn = [
      ...root.querySelectorAll<HTMLButtonElement>('button'),
    ].find((b) => b.textContent?.includes('page.catalog.confirmImport'));
    confirmBtn?.click();

    // On 409 import_conflict, stale preview card is cleared and import_conflict error is surfaced
    await vi.waitFor(() => {
      expect(root.textContent).toContain('page.errors.import_conflict');
      expect(root.textContent).not.toContain('page.catalog.previewTitle');
    });
  });
});
