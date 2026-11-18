// @vitest-environment happy-dom
import type { CatalogObject } from './api';

import { createApp, h, nextTick } from 'vue';

import { describe, expect, it } from 'vitest';

import { createSessionStore, sessionKey } from '#/shared/session';

import { chooseCampus, useCampus } from './campus';

const school = (id: string) => ({ id }) as CatalogObject;

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
  it('uses the only school record, or the configured one among several', () => {
    expect(() => chooseCampus([school('a')], undefined)).toThrow();
    expect(chooseCampus([school('a')], 'a').id).toBe('a');
    expect(chooseCampus([school('a'), school('b')], 'b').id).toBe('b');
  });
  it('refuses to guess when the record is missing or ambiguous', () => {
    expect(() => chooseCampus([], undefined)).toThrow();
    expect(() => chooseCampus([school('a'), school('b')], undefined)).toThrow();
    expect(() => chooseCampus([school('a')], 'b')).toThrow();
  });
  it('isolates campus state per session store and clears stale school ID on session invalidation (A-11)', async () => {
    const fetcher: typeof fetch = async (input) => {
      const path = new URL(String(input), 'http://localhost').pathname;
      if (path === '/api/v1/auth/session') {
        return Response.json(makeSession('buaa'));
      }
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
      expect(campusA.id.value).toBe('buaa');
      // Separate session store has its own isolated campus state
      expect(campusB.status.value).toBe('idle');
      expect(campusB.id.value).toBe('');

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
