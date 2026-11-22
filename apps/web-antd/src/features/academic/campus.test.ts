// @vitest-environment happy-dom
import { createApp, h, nextTick } from 'vue';

import { describe, expect, it } from 'vitest';

import { createSessionStore, sessionKey } from '#/shared/session';

import { useCampus } from './campus';

const makeSession = (schoolId: string) => ({
  administrator: true,
  authenticated: true,
  content_school_id: schoolId,
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
});

describe('served university', () => {
  it('uses the session school without public catalog eligibility and clears it on invalidation (A-11)', async () => {
    let catalogRequests = 0;
    let configuredSchool = 'buaa';
    let consentPending = false;
    const fetcher: typeof fetch = async (input) => {
      const path = new URL(String(input), 'http://localhost').pathname;
      if (path === '/api/v1/auth/session') {
        if (consentPending) {
          return Response.json({
            authenticated: true,
            consent_required: true,
            csrf_token: 'a'.repeat(43),
            expires_at: '2030-01-01T00:00:00Z',
          });
        }
        return Response.json(makeSession(configuredSchool));
      }
      catalogRequests++;
      return Response.json({ code: 'forbidden' }, { status: 403 });
    };
    globalThis.fetch = fetcher;
    const sessionA = createSessionStore(fetcher);
    const sessionB = createSessionStore(fetcher);
    let campusA!: ReturnType<typeof useCampus>;
    let campusB!: ReturnType<typeof useCampus>;

    const rootA = document.createElement('div');
    const rootB = document.createElement('div');
    let which: 'A' | 'B' = 'A';
    const Probe = {
      setup() {
        const current = useCampus();
        if (which === 'A') campusA = current;
        else campusB = current;
        return () => h('div');
      },
    };
    const appA = createApp(Probe);
    const appB = createApp(Probe);
    appA.provide(sessionKey, sessionA);
    appB.provide(sessionKey, sessionB);
    appA.mount(rootA);
    which = 'B';
    appB.mount(rootB);

    try {
      await campusA.load();
      expect(campusA.status.value).toBe('ready');
      expect(campusA.id.value).toBe('buaa');
      expect(catalogRequests).toBe(0);
      // Separate session store has its own isolated campus state
      expect(campusB.status.value).toBe('idle');
      expect(campusB.id.value).toBe('');

      configuredSchool = 'next-school';
      await campusA.load();
      expect(campusA.status.value).toBe('ready');
      expect(campusA.id.value).toBe('next-school');
      expect(campusB.id.value).toBe('');

      consentPending = true;
      await sessionA.reload();
      expect(campusA.id.value).toBe('');
      expect(campusA.failure.value).toBe('consent_required');
      expect(campusA.status.value).toBe('error');

      consentPending = false;
      await sessionA.reload();
      expect(campusA.id.value).toBe('next-school');
      expect(campusA.status.value).toBe('ready');

      // Invalidating sessionA clears stale campusId and resets status
      sessionA.invalidate();
      await nextTick();
      expect(campusA.id.value).toBe('');
      expect(campusA.status.value).toBe('idle');
    } finally {
      appA.unmount();
      appB.unmount();
    }
  });
});
