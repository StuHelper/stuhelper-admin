import type { SetupContext } from 'vue';

import type { ReviewSite } from './matchingApi';

import { createApp, h, nextTick } from 'vue';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { Http } from '#/shared/api/http';

import { TeacherMatchingApi } from './matchingApi';
import MatchingReview from './MatchingReview.vue';

const mock = vi.hoisted(() => ({
  http: undefined as Http | undefined,
  leave: vi.fn<(message: () => string) => void>(),
}));

vi.mock('#/shared/session', () => ({ useHttp: () => mock.http }));
vi.mock('#/shared/composables/leave', () => ({ useLeaveGuard: mock.leave }));
vi.mock('#/shared/format', () => ({ useFormat: () => ({ number: String }) }));
vi.mock('@vben/locales', () => ({
  useI18n: () => ({ t: (key: string) => key, te: () => true }),
}));
vi.mock('vue-router', () => ({
  RouterLink: (_: unknown, { slots }: SetupContext) => h('a', slots.default?.()),
}));
vi.mock('ant-design-vue', async (importOriginal) => ({
  ...await importOriginal<typeof import('ant-design-vue')>(),
  Popconfirm: {
    props: { disabled: Boolean },
    emits: ['confirm'],
    setup: (props: { disabled: boolean }, { emit, slots }: SetupContext<['confirm']>) => () => h('div', [
      slots.default?.(),
      h('button', {
        'data-confirm': '',
        disabled: props.disabled,
        onClick: () => emit('confirm'),
      }),
    ]),
  },
}));

const catalogName = 'Directory Teacher';
const siteName = 'Official Teacher';
const siteId = `site-${'a'.repeat(64)}`;
const teacherId = 'dir-teacher';
const teacher = {
  teacher_id: teacherId,
  name: catalogName,
  department: 'Directory Department',
};
const site: ReviewSite = {
  site_id: siteId,
  name: siteName,
  unit: 'Official Department',
  present: true,
  candidate_count: 1,
  candidates: [teacher],
  decision_revision: 2,
};
const sitePage = (items: ReviewSite[] = [site], next = '') => ({
  items,
  next,
  total: items.length,
});
const teacherPage = (next = '') => ({
  items: [
    {
      ...teacher,
      candidates: [],
      candidate_count: 0,
    },
  ],
  next,
  total: 1,
});
const url = (input: RequestInfo | URL) => new URL(String(input), 'http://localhost');
const rejected = (code: string, status: number) => Response.json({ code }, { status });

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
  mock.http = undefined;
  mock.leave.mockReset();
});

async function settled() {
  for (let tick = 0; tick < 4; tick++) {
    await nextTick();
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
}

async function mount(fetcher: typeof fetch, mayWrite = true) {
  mock.http = new Http(fetcher);
  const root = document.createElement('div');
  document.body.append(root);
  const app = createApp(MatchingReview, { mayWrite, school: 'school-a' });
  app.mount(root);
  cleanups.push(() => {
    app.unmount();
    root.remove();
  });
  await settled();
  return root;
}

const prefix = 'page.teacherHomepage.match';
function button(root: HTMLElement, label: string) {
  const match = [...root.querySelectorAll('button')].find(
    (value) => value.textContent?.trim() === label,
  );
  if (!match) throw new Error(`Missing button: ${label}`);
  return match;
}

function review(root: HTMLElement) {
  return root.querySelector<HTMLElement>(`[aria-label="${prefix}.reviewTitle"]`)!;
}

function confirmBind(root: HTMLElement) {
  const bind = button(review(root), `${prefix}.action.bind`);
  expect(bind.disabled).toBe(false);
  bind.parentElement?.querySelector<HTMLButtonElement>('[data-confirm]')?.click();
}

describe('teacher homepage matching API', () => {
  it('uses the next cursor to find the exact matching site after a false-positive substring match', async () => {
    const queries: Record<string, string>[] = [];
    const api = new TeacherMatchingApi(new Http(async (input) => {
      const request = url(input);
      expect(request.pathname).toBe('/api/v1/catalog/admin/schools/school-a/teacher-sites/review/sites');
      queries.push(Object.fromEntries(request.searchParams));
      if (request.searchParams.get('after') === 'later') {
        return Response.json(sitePage());
      }
      // The target ID appears in another site's unit, so the server returns
      // that row first even though its own ID is different.
      return Response.json(sitePage([
        { ...site, site_id: `site-${'1'.repeat(64)}`, unit: siteId },
      ], 'later'));
    }));

    expect(await api.site('school-a', siteId, new AbortController().signal)).toEqual(site);
    expect(queries).toEqual([
      { status: 'all', q: siteId, limit: '20' },
      { status: 'all', q: siteId, limit: '20', after: 'later' },
    ]);
  });

  it('rejects malformed candidate data from the school review API', async () => {
    const api = new TeacherMatchingApi(new Http(async () =>
      Response.json(sitePage([{ ...site, candidate_count: -1 }])),
    ));
    await expect(api.sites('school-a', { status: 'pending' })).rejects.toMatchObject({
      code: 'incompatible',
    });
  });
});

describe('teacher homepage matching review', () => {
  it('reloads a changed cursor from the first page without keeping stale rows', async () => {
    let pages = 0;
    const readHistory: (null | string)[] = [];
    const root = await mount(async (input) => {
      const request = url(input);
      if (request.pathname.endsWith('/teachers')) return Response.json(teacherPage());

      const after = request.searchParams.get('after');
      readHistory.push(after);
      if (after) return rejected('revision_conflict', 409);
      pages++;
      return Response.json(
        pages === 1
          ? sitePage([site], 'old-cursor')
          : sitePage([{ ...site, name: 'New Snapshot' }]),
      );
    });

    expect(root.textContent).toContain(siteName);
    button(root, 'page.common.loadMore').click();
    await settled();
    expect(readHistory).toEqual([null, 'old-cursor', null]);
    expect(root.textContent).not.toContain(siteName);
    expect(root.textContent).toContain('New Snapshot');
    expect(root.textContent).toContain(`${prefix}.cursorConflict`);
  });

  it('preserves the draft on a revision conflict and sends a new key only after another confirmation', async () => {
    const writes: { body: unknown; key: null | string }[] = [];
    let currentSite = site;
    const root = await mount(async (input, init) => {
      const request = url(input);
      if (request.pathname.endsWith('/teachers')) return Response.json(teacherPage());
      if (request.pathname.endsWith('/sites')) return Response.json(sitePage([currentSite]));

      const key = new Headers(init?.headers).get('Idempotency-Key');
      const body = JSON.parse(String(init?.body));
      writes.push({ body, key });
      if (writes.length === 1) {
        currentSite = { ...site, decision_revision: 8 };
        return rejected('revision_conflict', 409);
      }
      const decision = { action: 'bind', teacher_id: teacherId } as const;
      currentSite = { ...currentSite, decision_revision: 9, decision };
      return Response.json({ site_id: siteId, decision_revision: 9, decision });
    });

    button(root, `${prefix}.reviewSite`).click();
    await settled();
    button(review(root), `${prefix}.chooseTeacher`).click();
    const guard = mock.leave.mock.calls[0]?.[0];
    expect(guard?.()).toBe('page.common.leaveUnsaved');
    await settled();
    confirmBind(root);
    await settled();
    expect(writes).toHaveLength(1);
    expect(review(root).textContent).toContain(`${prefix}.conflictReloaded`);
    expect(review(root).textContent).toContain(`${prefix}.selectedTeacher`);

    confirmBind(root);
    await settled();
    expect(writes.map(({ body }) => body)).toEqual([
      { action: 'bind', expected_revision: 2, teacher_id: teacherId },
      { action: 'bind', expected_revision: 8, teacher_id: teacherId },
    ]);
    expect(writes[0]?.key).toBeTruthy();
    expect(writes[1]?.key).toBeTruthy();
    expect(writes[0]?.key).not.toBe(writes[1]?.key);
    expect(review(root).textContent).toContain(`${prefix}.decision.bind`);
    expect(guard?.()).toBe('');
  });

  it('clears forbidden review data while preserving the exact retry for a lost write reply', async () => {
    const writes: { body: string; key: null | string }[] = [];
    const root = await mount(async (input, init) => {
      const request = url(input);
      if (request.pathname.endsWith('/teachers')) {
        return request.searchParams.has('after')
          ? rejected('forbidden', 403)
          : Response.json(teacherPage('more-teachers'));
      }
      if (request.pathname.endsWith('/sites')) return Response.json(sitePage());

      writes.push({
        body: String(init?.body),
        key: new Headers(init?.headers).get('Idempotency-Key'),
      });
      if (writes.length === 1) throw new Error('connection reset');
      return Response.json({ site_id: siteId, decision_revision: 3 });
    });

    button(root, `${prefix}.reviewSite`).click();
    await settled();
    button(review(root), `${prefix}.chooseTeacher`).click();
    await settled();
    confirmBind(root);
    await settled();
    expect(mock.leave.mock.calls[0]?.[0]()).toBe('page.common.leaveUncertain');
    expect(button(review(root), `${prefix}.action.bind`).disabled).toBe(true);

    button(root, 'page.common.loadMore').click();
    await settled();
    expect(root.textContent).toContain('page.errors.forbidden');
    expect(root.textContent).not.toContain(siteName);
    expect(root.textContent).not.toContain(catalogName);

    button(root, 'page.common.retryOriginal').click();
    await settled();
    expect(writes).toHaveLength(2);
    expect(writes[0]?.key).toBeTruthy();
    expect(writes[1]).toEqual(writes[0]);
    expect(root.textContent).not.toContain('page.common.retryOriginal');
  });

  it('shows candidates with read permission alone and hides all matching writes', async () => {
    const root = await mount(async (input) =>
      Response.json(url(input).pathname.endsWith('/sites') ? sitePage() : teacherPage()),
    false);

    button(root, `${prefix}.reviewSite`).click();
    await settled();
    expect(review(root).textContent).toContain('Directory Department');
    expect(root.textContent).not.toContain(`${prefix}.chooseTeacher`);
    expect(root.textContent).not.toContain(`${prefix}.action.reject`);
    expect(root.textContent).not.toContain(`${prefix}.profile`);
  });
});
