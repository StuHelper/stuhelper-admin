// @vitest-environment happy-dom
import { createApp, nextTick } from 'vue';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from '#/shared/api/errors';
import { createSessionStore, sessionKey } from '#/shared/session';

import VerificationView from './VerificationView.vue';

const routerGuards = vi.hoisted(() => ({
  leave: [] as Array<() => boolean>,
}));

vi.mock('vue-router', () => ({
  onBeforeRouteLeave: (fn: () => boolean) => routerGuards.leave.push(fn),
  onBeforeRouteUpdate: () => {},
}));

vi.mock('@vben/locales', () => ({
  useI18n: () => ({
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

const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const clean of cleanups.splice(0)) clean();
  routerGuards.leave.length = 0;
  vi.restoreAllMocks();
});

const school = {
  email_domain: 'buaa.edu.cn',
  enabled: true,
  id: 'buaa',
  material_types: ['student_card'],
  methods: ['manual_material_review'],
  name: 'BUAA',
  newcomer_days: 90,
  notice_version: 'v1',
  opening_date: '2026-09-01',
  revision: 1,
};

const suggestionSafe = {
  id: 'sug-1',
  name: 'Safe University',
  note: '',
  revision: 1,
  state: 'pending',
  website: 'https://www.buaa.edu.cn',
};

const suggestionXss = {
  id: 'sug-2',
  name: 'Evil University',
  note: '',
  revision: 1,
  state: 'pending',
  website: 'javascript:alert(document.cookie)',
};

const credential = {
  expires_at: null,
  id: 'cred-1',
  kind: 'student',
  method: 'school_sso',
  revision: 1,
  school_id: 'buaa',
  stage: 'bachelor',
  state: 'active',
  student_display: '*明',
  verified_at: '2026-09-01T00:00:00Z',
};

const fullProfile = {
  collected_at: '2026-09-01T00:00:00Z',
  data_status: 'complete',
  field_sources: { name: 'sso_profile', student_id: 'sso_profile' },
  fields: { name: '张小明', student_id: '23371001' },
  raw_data: '{"secret":"academic-raw-record"}',
  revision: 1,
  schema: 'v1',
  school_id: 'buaa',
  source_revision: 'r1',
};

const application = {
  created_at: '2026-10-01T00:00:00Z',
  credential_id: '',
  expires_at: '2026-12-01T00:00:00Z',
  id: 'app-1',
  kind: 'student',
  method: 'manual_material_review',
  result_code: '',
  revision: 3,
  school_id: 'buaa',
  stage: 'bachelor',
  state: 'pending_review',
  updated_at: '2026-10-01T00:00:00Z',
};

const manualForm = {
  department: 'CS',
  email: 'stu@buaa.edu.cn',
  material_ids: [],
  material_type: 'student_card',
  name: '张小明',
  revision: 3,
  student_id: '23371001',
};

describe('VerificationView security, revocation cleanup and idempotent locking (A-01, A-03, A-07, A-19)', () => {
  it('recovers from initial access error, blocks javascript: suggestion links, assigns unique form IDs, wipes profile on 403, and locks uncertain writes', async () => {
    let failAccess = true;
    let revokeDenied = false;
    let reviewLost = true;
    const reviewKeys: Array<null | string> = [];

    const fetcher: typeof fetch = async (input, init) => {
      const url = new URL(String(input), 'http://localhost');
      const path = url.pathname;
      if (path === '/api/v1/auth/session') {
        return Response.json({
          administrator: true,
          authenticated: true,
          content_school_id: 'buaa',
          csrf_token: 'a'.repeat(43),
          expires_at: '2030-01-01T00:00:00Z',
          phone_bound: true,
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
        });
      }
      if (path === '/api/v1/admin/verification/access') {
        if (failAccess) return Response.json({}, { status: 503 });
        return Response.json({ allowed: true });
      }
      if (path === '/api/v1/verification/schools') {
        return Response.json([school]);
      }
      if (path === '/api/v1/admin/verification/schools/buaa/applications') {
        return Response.json([application]);
      }
      if (path === '/api/v1/admin/verification/suggestions') {
        return Response.json([suggestionSafe, suggestionXss]);
      }
      if (path === '/api/v1/admin/verification/credentials/cred-1') {
        return Response.json(credential);
      }
      if (path === '/api/v1/admin/verification/credentials/cred-1/profile') {
        return Response.json(fullProfile);
      }
      if (path === '/api/v1/admin/verification/credentials/cred-1/revoke') {
        if (revokeDenied) {
          return Response.json({ code: 'verification_permission_denied' }, { status: 403 });
        }
        return Response.json({ ...credential, state: 'revoked', revision: 2 });
      }
      if (path === '/api/v1/admin/verification/applications/app-1/form') {
        return Response.json(manualForm);
      }
      if (path === '/api/v1/verification/applications/app-1/materials') {
        return Response.json([]);
      }
      if (path === '/api/v1/admin/verification/applications/app-1/review') {
        reviewKeys.push(new Headers(init?.headers).get('Idempotency-Key'));
        if (reviewLost) throw new ApiError('timeout', true);
        return Response.json({ ...application, state: 'approved', revision: 4 });
      }
      return Response.json({ code: 'not_found' }, { status: 404 });
    };

    const sessionStore = createSessionStore(fetcher);
    await sessionStore.reload();
    vi.stubGlobal('fetch', fetcher);
    vi.stubGlobal('window', Object.assign(globalThis.window, {
      location: { assign: vi.fn(), href: 'http://localhost/', origin: 'http://localhost' },
    }));

    const root = document.createElement('div');
    document.body.append(root);
    const app = createApp(VerificationView);
    app.provide(sessionKey, sessionStore);
    app.mount(root);
    cleanups.push(() => {
      app.unmount();
      root.remove();
    });

    // A-19 / A-07: useLeaveGuard is registered
    expect(routerGuards.leave.length).toBeGreaterThan(0);

    // A-07: Initial access error shows a retry button that recovers
    await vi.waitFor(() => {
      expect(root.textContent).toContain('page.errors.unavailable');
    });
    const retryAccess = [...root.querySelectorAll('button')].find((b) =>
      b.textContent?.includes('page.common.retry'),
    );
    expect(retryAccess).toBeDefined();
    failAccess = false;
    retryAccess?.click();
    await vi.waitFor(() => {
      expect(root.textContent).toContain('page.verification.tabs.suggestions');
    });

    // A-01 & A-19: Suggestions tab blocks javascript: href and uses unique textarea IDs
    const suggestionsTab = [...root.querySelectorAll('[role="tab"]')].find((el) =>
      el.textContent?.includes('page.verification.tabs.suggestions'),
    ) as HTMLElement | undefined;
    suggestionsTab?.click();
    await vi.waitFor(() => {
      expect(root.textContent).toContain('Evil University');
    });
    const anchors = [...root.querySelectorAll('a')].map((a) =>
      a.getAttribute('href'),
    );
    expect(anchors).toContain('https://www.buaa.edu.cn/');
    expect(anchors.some((href) => href?.startsWith('javascript:'))).toBe(false);
    const suggestionTextareas = [
      ...root.querySelectorAll('textarea[id^="verification-suggestion-note-"]'),
    ];
    expect(suggestionTextareas).toHaveLength(2);
    expect(suggestionTextareas[0]?.id).not.toBe(suggestionTextareas[1]?.id);

    // A-03: Credentials tab wipes studentProfile and credential on 403 revocation
    const credentialsTab = [...root.querySelectorAll('[role="tab"]')].find((el) =>
      el.textContent?.includes('page.verification.tabs.credentials'),
    ) as HTMLElement | undefined;
    credentialsTab?.click();
    await nextTick();
    const credInput = root.querySelector(
      '#verificationview-field-3',
    ) as HTMLInputElement;
    credInput.value = 'cred-1';
    credInput.dispatchEvent(new Event('input'));
    await nextTick();
    credInput.closest('form')?.dispatchEvent(new Event('submit'));
    await vi.waitFor(() => {
      expect(root.textContent).toContain('*明');
    });
    const rawBtn = [...root.querySelectorAll('button')].find((b) =>
      b.textContent?.includes('page.verification.profileRaw'),
    );
    rawBtn?.click();
    await vi.waitFor(() => {
      expect(root.textContent).toContain('academic-raw-record');
    });
    const credNote = root.querySelector(
      '#verificationview-field-4',
    ) as HTMLTextAreaElement;
    credNote.value = 'Revoke reason';
    credNote.dispatchEvent(new Event('input'));
    await nextTick();
    revokeDenied = true;
    const revokeBtn = [...root.querySelectorAll('button')].find((b) =>
      b.textContent?.includes('page.verification.revoke'),
    );
    revokeBtn?.click();
    await vi.waitFor(() => {
      expect(root.textContent).not.toContain('academic-raw-record');
      expect(root.textContent).not.toContain('*明');
    });

    // A-07: Uncertain review write locks form and retries with original Idempotency-Key
    const reviewsTab = [...root.querySelectorAll('[role="tab"]')].find((el) =>
      el.textContent?.includes('page.verification.tabs.reviews'),
    ) as HTMLElement | undefined;
    reviewsTab?.click();
    await vi.waitFor(() => {
      expect(root.textContent).toContain('page.verification.review');
    });
    const openBtn = [...root.querySelectorAll('button')].find((b) =>
      b.textContent?.includes('page.verification.review'),
    );
    openBtn?.click();
    await vi.waitFor(() => {
      expect(document.body.textContent).toContain('23371001');
    });
    const approveBtn = [
      ...document.querySelectorAll<HTMLButtonElement>('.ant-drawer button'),
    ].find((b) => b.textContent?.includes('page.verification.approve'));
    approveBtn?.click();
    await vi.waitFor(() => {
      expect(document.body.textContent).toContain('page.common.uncertain');
    });
    expect(approveBtn?.disabled).toBe(true);
    reviewLost = false;
    const retryOrig = [
      ...document.querySelectorAll<HTMLButtonElement>('.ant-drawer button'),
    ].find((b) => b.textContent?.includes('page.common.retryOriginal'));
    retryOrig?.click();
    await vi.waitFor(() => {
      expect(reviewKeys).toHaveLength(2);
    });
    expect(reviewKeys[0]).toBeTruthy();
    expect(reviewKeys[1]).toBe(reviewKeys[0]);
  });
});
