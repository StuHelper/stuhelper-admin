// @vitest-environment happy-dom
import { createApp, h, nextTick, ref } from 'vue';

import { afterEach, describe, expect, it, vi } from 'vitest';

import PresentationView from '#/features/academic/PresentationView.vue';
import EligibilityView from '#/features/eligibility/EligibilityView.vue';
import AppsView from '#/features/open-platform/AppsView.vue';
import BindingView from '#/features/qq-binding/BindingView.vue';
import { createSessionStore, sessionKey } from '#/shared/session';

import ConfigView from './ConfigView.vue';
import MembershipsView from './MembershipsView.vue';

vi.mock('vue-router', () => ({
  onBeforeRouteLeave: () => {},
  onBeforeRouteUpdate: () => {},
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

describe('Conflict comparison, directory tree pagination, AppsView filter advance, and i18n polish (A-09, A-15, A-18, A-20)', () => {
  it('preserves drafts and shows server comparison on 409 conflict, paginates >100 folders in MembershipsView, auto-advances AppsView past filtered pages, localizes EligibilityView action names, and omits empty Card in PresentationView', async () => {
    const view = ref<
      'apps' | 'binding' | 'config' | 'eligibility' | 'memberships' | 'presentation'
    >('config');

    let offerVersion = 1;
    let offerPoints = 100;
    let eligVersion = '7';
    let bindingRev = 2;
    let denyInspection = false;
    let directoryRequests = 0;
    let peakDirectoryRequests = 0;
    const appReviews: number[] = [];

    const fetcher: typeof fetch = async (input, init) => {
      const url = new URL(String(input), 'http://localhost');
      const path = url.pathname;
      const method = (init?.method ?? 'GET').toUpperCase();

      if (path === '/api/v1/auth/session') return Response.json(sessionPayload);
      if (path === '/api/v1/catalog/objects') {
        return Response.json({
          items: [
            {
              aliases: [],
              credits: null,
              id: 'buaa',
              kind: 'school',
              name: 'BUAA',
              revision: 1,
              school_id: 'buaa',
              updated_at: '2026-11-18T00:00:00Z',
            },
          ],
          next: '',
        });
      }

      // Billing Config
      if (path === '/api/v1/billing/admin/channels') {
        return Response.json({ items: [], next: '' });
      }
      if (path === '/api/v1/billing/admin/rules') {
        return Response.json({ items: [], next: '' });
      }
      if (path === '/api/v1/billing/admin/offers' && method === 'GET') {
        return Response.json({
          items: [
            {
              amount_minor: 1000,
              enabled: true,
              id: 'offer-1',
              points: offerPoints,
              valid_seconds: 0,
              version: offerVersion,
            },
          ],
          next: '',
        });
      }
      if (path.startsWith('/api/v1/billing/admin/offers/') && method !== 'GET') {
        offerVersion = 2;
        offerPoints = 250;
        return Response.json({ code: 'billing_conflict' }, { status: 409 });
      }

      // Memberships & >100 directories
      if (path === '/api/v1/billing/admin/membership-plans') {
        return Response.json([
          {
            enabled: true,
            id: 'plan-1',
            ivory_minor: 1000,
            name: 'Semester Pass',
            points: 500,
            valid_seconds: 30 * 86_400,
            version: 1,
          },
        ]);
      }
      if (path === '/api/v1/resources/coverage/plan-1') {
        return Response.json({
          plan_id: 'plan-1',
          revision: 1,
          rules: [{ directory_id: 'dir-101', school_id: 'buaa' }],
        });
      }
      if (path === '/api/v1/resources/categories') {
        return Response.json({ items: [], next_cursor: '' });
      }
      if (path === '/api/v1/resources/directories') {
        const parent = url.searchParams.get('parent_id') ?? '';
        const after = url.searchParams.get('after') ?? '';
        if (parent) {
          directoryRequests++;
          peakDirectoryRequests = Math.max(peakDirectoryRequests, directoryRequests);
          await new Promise((resolve) => setTimeout(resolve, 1));
          directoryRequests--;
          const children = /^dir-[1-5]$/.test(parent) ? Array.from({ length: 5 }, (_, i) => ({
            enabled: true, id: `${parent}-${i}`, names: { 'zh-CN': '子目录' }, revision: 1, school_id: 'buaa',
          })) : [];
          return Response.json({ items: children, next_cursor: '' });
        }
        if (!after) {
          return Response.json({
            items: Array.from({ length: 100 }, (_, i) => ({
              enabled: true,
              id: `dir-${i + 1}`,
              names: { 'zh-CN': `目录 ${i + 1}` },
              revision: 1,
              school_id: 'buaa',
            })),
            next_cursor: 'dir-100',
          });
        }
        return Response.json({
          items: [
            {
              enabled: true,
              id: 'dir-101',
              names: { 'zh-CN': '目录 101' },
              revision: 1,
              school_id: 'buaa',
            },
          ],
          next_cursor: '',
        });
      }

      // Eligibility
      if (path.startsWith('/api/v1/platform/eligibility/')) {
        if (method === 'GET') {
          return Response.json({
            conditions: ['campus_eligibility'],
            version: eligVersion,
          });
        }
        eligVersion = '8';
        return Response.json({ code: 'conflict' }, { status: 409 });
      }

      // QQ Binding
      if (path === '/api/v1/qq-binding/admin/accounts/acc-1') {
        if (denyInspection) return Response.json({ code: 'forbidden' }, { status: 403 });
        return Response.json({
          complete: true,
          connect: { bound: true, revision: bindingRev },
          official: { bound: true, revision: 1 },
          onebot: { bound: true, revision: 1 },
          qq_number: '28******56',
        });
      }
      if (path === '/api/v1/qq-binding/admin/accounts/acc-1/release') {
        bindingRev = 3;
        return Response.json(
          { code: 'qq_binding_revision_conflict' },
          { status: 409 },
        );
      }

      // Open Platform Apps
      if (path === '/api/v1/open-platform/admin/apps/a2/review') {
        appReviews.push(JSON.parse(String(init?.body)).revision);
        return Response.json({ code: 'conflict' }, { status: 409 });
      }
      if (path === '/api/v1/open-platform/admin/apps') {
        const after = url.searchParams.get('after') ?? '';
        const makeApp = (id: string, name: string, state: string) => ({
          approved_scopes: [],
          client_type: 'confidential',
          created_at: '2026-11-18T00:00:00Z',
          credential_revision: 0,
          id,
          name,
          note: '',
          policy: { daily_quota: 0, grant_seconds: 0, token_seconds: 0 },
          purpose: 'Purpose',
          redirect_uris: ['https://example.invalid/cb'],
          requested_scopes: ['profile'],
          revision: 1,
          state,
        });
        if (!after) {
          return Response.json({
            items: [makeApp('a1', 'Active One', 'active')],
            next: 'c1',
          });
        }
        return Response.json({
          items: [{ ...makeApp('a2', 'Pending Two', 'pending'),
            revision: appReviews.length > 0 ? 3 : 1,
            policy: { grant_seconds: 172_800, token_seconds: 1800, daily_quota: 777 },
          }],
        });
      }

      // Presentation
      if (path === '/api/v1/reviews/admin/presentation') {
        return Response.json({
          configured: {
            rating_texts: {},
            revision: 1,
            school_id: 'buaa',
          },
          effective: {
            rating_texts: {},
            revision: 1,
            school_id: 'buaa',
          },
          source: 'school',
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
        return () => {
          switch (view.value) {
            case 'apps': {
              return h(AppsView);
            }
            case 'binding': {
              return h(BindingView);
            }
            case 'config': {
              return h(ConfigView);
            }
            case 'eligibility': {
              return h(EligibilityView);
            }
            case 'memberships': {
              return h(MembershipsView);
            }
            case 'presentation': {
              return h(PresentationView);
            }
          }
        };
      },
    });
    app.provide(sessionKey, store);
    app.mount(root);
    cleanups.push(() => {
      app.unmount();
      root.remove();
    });

    // 1. A-15: ConfigView preserves draft and shows compareNotice on 409 billing_conflict
    await vi.waitFor(() => {
      expect(root.textContent).toContain('offer-1');
    });
    const editOfferBtn = [
      ...root.querySelectorAll<HTMLButtonElement>('button'),
    ].find((b) => b.textContent?.includes('page.common.edit'));
    editOfferBtn?.click();
    await vi.waitFor(() => {
      expect(document.querySelector('#billing-config-points')).not.toBeNull();
    });
    const pointsInput = document.querySelector(
      '#billing-config-points',
    ) as HTMLInputElement;
    pointsInput.value = '888';
    pointsInput.dispatchEvent(new Event('input'));
    pointsInput.dispatchEvent(new Event('change'));
    await nextTick();
    const saveBtn = [
      ...document.querySelectorAll<HTMLButtonElement>('.ant-drawer button'),
    ].find((b) => b.textContent?.includes('page.common.save'));
    saveBtn?.click();
    await vi.waitFor(() => {
      expect(document.body.textContent).toContain('page.common.reloadCompare');
    });
    const compareBtn = [
      ...document.querySelectorAll<HTMLButtonElement>('.ant-drawer button'),
    ].find((b) => b.textContent?.includes('page.common.reloadCompare'));
    compareBtn?.click();
    await vi.waitFor(() => {
      // Drawer must stay open with draft 888 AND show compareNotice with server's 250!
      expect(document.querySelector('#billing-config-points')).not.toBeNull();
      expect(
        (document.querySelector('#billing-config-points') as HTMLInputElement)
          .value,
      ).toBe('888');
      expect(document.body.textContent).toContain('page.common.compareNotice');
      expect(document.body.textContent).toContain('250');
    });

    // 2. A-18: MembershipsView folderTree paginates past 100 directories to include 目录 101
    view.value = 'memberships';
    await vi.waitFor(() => {
      expect(root.textContent).toContain('Semester Pass');
    });
    const editCovBtn = [
      ...root.querySelectorAll<HTMLButtonElement>('button'),
    ].find((b) =>
      b.textContent?.includes('page.billing.memberships.editCoverage'),
    );
    editCovBtn?.click();
    await vi.waitFor(() => {
      // TreeSelect resolves dir-101 from page 2 to its localized title "目录 101" instead of raw ID "dir-101"
      expect(document.body.textContent).toContain('目录 101');
    });

    expect(peakDirectoryRequests).toBeLessThanOrEqual(5);

    // 3. A-20 + A-15: EligibilityView passes localized action name and keeps draft on 409 conflict
    view.value = 'eligibility';
    await vi.waitFor(() => {
      expect(root.textContent).toContain(
        'page.eligibility.actions.resources_purchase',
      );
    });
    const eligEditBtn = root.querySelector(
      'button[aria-label*="page.eligibility.actions.resources_purchase"]',
    ) as HTMLButtonElement | null;
    expect(eligEditBtn).not.toBeNull();
    eligEditBtn?.click();
    await vi.waitFor(() => {
      expect(document.body.textContent).toContain(
        'page.eligibility.edit.site:{"action":"page.eligibility.actions.resources_purchase"}',
      );
    });

    // 4. A-09: AppsView auto-advances past page of active apps when filter === 'pending'
    view.value = 'apps';
    await vi.waitFor(() => {
      expect(root.textContent).toContain('Pending Two');
    });

    const button = (where: ParentNode, key: string) =>
      [...where.querySelectorAll<HTMLButtonElement>('button')].find((item) => item.textContent?.includes(key));
    button(root, 'page.openPlatform.review')!.click();
    await vi.waitFor(() => expect(button(document.body, 'page.openPlatform.submit.approve')).toBeTruthy());
    button(document.body, 'page.openPlatform.submit.approve')!.click();
    await vi.waitFor(() => expect(button(document.body, 'page.common.reloadCompare')).toBeTruthy());
    button(document.body, 'page.common.reloadCompare')!.click();
    await vi.waitFor(() => {
      const summary = document.querySelector('.ant-drawer .ant-alert-description');
      expect(summary?.textContent).toContain('page.openPlatform.grantDays');
      expect(summary?.textContent).toContain('page.openPlatform.tokenMinutes');
      expect(summary?.textContent).toContain('777');
    });
    button(document.body, 'page.openPlatform.submit.approve')!.click();
    await vi.waitFor(() => expect(appReviews).toEqual([1, 3]));

    // 5. A-15: BindingView keeps release modal & reason on 409 qq_binding_revision_conflict
    view.value = 'binding';
    await vi.waitFor(() => {
      expect(document.querySelector('#qq-binding-owner')).not.toBeNull();
    });
    const ownerInput = document.querySelector(
      '#qq-binding-owner',
    ) as HTMLInputElement;
    ownerInput.value = 'acc-1';
    ownerInput.dispatchEvent(new Event('input'));
    await nextTick();
    const lookupBtn = [
      ...root.querySelectorAll<HTMLButtonElement>('button'),
    ].find((b) => b.textContent?.includes('page.qqBinding.lookup'));
    lookupBtn?.click();
    await vi.waitFor(() => {
      expect(root.textContent).toContain('28******56');
    });
    const releaseBtn = [
      ...root.querySelectorAll<HTMLButtonElement>('button'),
    ].find((b) => b.textContent?.includes('page.qqBinding.release'));
    releaseBtn?.click();
    await vi.waitFor(() => {
      expect(document.querySelector('#qq-binding-reason')).not.toBeNull();
    });
    const reasonArea = document.querySelector(
      '#qq-binding-reason',
    ) as HTMLTextAreaElement;
    reasonArea.value = 'Wrong account';
    reasonArea.dispatchEvent(new Event('input'));
    await nextTick();
    const confirmReleaseBtn = [
      ...document.querySelectorAll<HTMLButtonElement>('.ant-modal button'),
    ].find((b) => b.textContent?.includes('page.qqBinding.confirmRelease'));
    confirmReleaseBtn?.click();
    await vi.waitFor(() => {
      expect(document.body.textContent).toContain('page.common.reloadCompare');
    });
    const bindingCompareBtn = [
      ...document.querySelectorAll<HTMLButtonElement>('.ant-modal button'),
    ].find((b) => b.textContent?.includes('page.common.reloadCompare'));
    bindingCompareBtn?.click();
    await vi.waitFor(() => {
      expect(
        (document.querySelector('#qq-binding-reason') as HTMLTextAreaElement)
          .value,
      ).toBe('Wrong account');
      expect(document.body.textContent).toContain('page.common.compareNotice');
    });

    confirmReleaseBtn?.click();
    await vi.waitFor(() => expect(button(document.body, 'page.common.reloadCompare')).toBeTruthy());
    denyInspection = true;
    button(document.body, 'page.common.reloadCompare')!.click();
    await vi.waitFor(() => expect(root.textContent).not.toContain('28******56'));

    // 6. A-20: PresentationView does not render an empty Card before the main Card
    view.value = 'presentation';
    await vi.waitFor(() => {
      expect(root.textContent).toContain('page.moderation.ratingLanguage');
    });
    expect(root.querySelectorAll('.ant-card').length).toBe(1);
  }, 20_000);
});
