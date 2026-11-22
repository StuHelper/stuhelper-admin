import type { Session } from '#/shared/session';

import { describe, expect, it, vi } from 'vitest';

import { createSessionStore } from '#/shared/session';

import { createTeacherHomepageAccess } from './access';

const matching = '/catalog/teacher-sites/matching';
const settings = '/catalog/teacher-sites/settings';
const apiPrefix = '/api/v1/catalog/admin/schools/school/teacher-sites';
const readPath = `${apiPrefix}/review/sites?limit=1`;
const maintainPath = `${apiPrefix}/allowlist`;

type FullSession = Extract<Session, { consent_required: false }>;

function sessionValue(administrator: boolean): FullSession {
  return {
    administrator,
    authenticated: true,
    consent_required: false,
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
      nickname: 'Administrator',
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
}

const allowedRead = () => Response.json({ items: [], next: '', total: 0 });
const allowedMaintain = () => Response.json({ fields: [], revision: 0 });
const forbidden = () =>
  Response.json({ code: 'catalog_forbidden' }, { status: 403 });

async function fixture(
  administrator: boolean,
  catalog: (
    path: string,
    signal?: AbortSignal | null,
  ) => Promise<Response> | Response,
) {
  let user: Session = sessionValue(administrator);
  const fetcher = vi.fn<typeof fetch>(async (path, init) =>
    path === '/api/v1/auth/session'
      ? Response.json(user)
      : catalog(String(path), init?.signal),
  );
  const session = createSessionStore(fetcher);
  const access = createTeacherHomepageAccess(session, fetcher);
  await session.reload();
  return {
    access,
    paths: () =>
      fetcher.mock.calls
        .map(([path]) => path)
        .filter((path) => path !== '/api/v1/auth/session'),
    async switchSession(next: Session) {
      user = next;
      await session.reload();
    },
  };
}

describe('teacher homepage permissions', () => {
  it('uses the platform administrator session and hides a menu after a scoped denial', async () => {
    const { access, paths } = await fixture(true, () => forbidden());
    access.discover('/');
    expect(paths()).toEqual([]);
    expect(access.canShowMenu(matching)).toBe(true);
    expect(access.canShowMenu(settings)).toBe(true);
    expect(access.canMaintain.value).toBe(true);

    access.reportMaintain('school', false);
    expect(access.canShowMenu(settings)).toBe(false);
    expect(access.canMaintain.value).toBe(false);
    expect(access.canShowMenu(matching)).toBe(true);

    access.reportMaintain('other-school', true);
    expect(access.canMaintain.value).toBe(false);
  });

  it('discovers both delegated grants from home once and keeps read-only access independent', async () => {
    const { access, paths } = await fixture(false, (path) =>
      path === readPath ? allowedRead() : forbidden(),
    );
    access.discover('/');
    access.discover('/');
    await access.checkMaintain();
    await vi.waitFor(() => expect(access.canRead.value).toBe(true));
    expect(paths()).toEqual([readPath, maintainPath]);
    expect(access.canShowMenu(matching)).toBe(true);
    expect(access.canShowMenu(settings)).toBe(false);
    expect(access.canMaintain.value).toBe(false);
    access.discover('/catalog');
    expect(paths()).toEqual([readPath, maintainPath]);
  });

  it('preserves the menu after a failed probe and coalesces manual retries before enabling writes', async () => {
    let failed = true;
    const { access, paths } = await fixture(false, () =>
      failed
        ? Response.json({ code: 'catalog_unavailable' }, { status: 503 })
        : allowedMaintain(),
    );
    access.discover(`${matching}/`);
    await access.checkMaintain();
    expect(paths()).toEqual([maintainPath]);
    expect(access.maintainError.value).toBe('unavailable');
    expect(access.canShowMenu(settings)).toBe(true);
    expect(access.canMaintain.value).toBe(false);

    failed = false;
    await Promise.all([access.retryMaintain(), access.retryMaintain()]);
    expect(paths()).toEqual([maintainPath, maintainPath]);
    expect(access.maintainError.value).toBe('');
    expect(access.canMaintain.value).toBe(true);
  });

  it('cancels outstanding discovery when the account changes and ignores facts from another school', async () => {
    let complete: ((value: Response) => void) | undefined;
    let pendingSignal: AbortSignal | null | undefined;
    const { access, switchSession } = await fixture(false, (path, signal) => {
      if (path !== maintainPath) return forbidden();
      pendingSignal = signal;
      return new Promise<Response>((resolve) => {
        complete = resolve;
      });
    });
    const previous = access.checkMaintain();
    const user = sessionValue(false);
    user.profile.id = '00000000-0000-4000-8000-000000000002';
    await switchSession(user);
    expect(pendingSignal?.aborted).toBe(true);
    complete?.(allowedMaintain());
    await previous;
    expect(access.canMaintain.value).toBe(false);

    access.reportMaintain('school', true);
    expect(access.canMaintain.value).toBe(true);
    await switchSession({ ...user, content_school_id: 'new-school' });
    expect(access.canMaintain.value).toBe(false);
    access.reportMaintain('school', true);
    expect(access.canMaintain.value).toBe(false);
  });

  it('clears school permissions while consent is pending and rediscovers them in the new school', async () => {
    let complete: ((value: Response) => void) | undefined;
    let pendingSignal: AbortSignal | null | undefined;
    const { access, paths, switchSession } = await fixture(false, (path, signal) => {
      if (path === maintainPath) {
        pendingSignal = signal;
        return new Promise<Response>((resolve) => {
          complete = resolve;
        });
      }
      return path.endsWith('/allowlist') ? allowedMaintain() : allowedRead();
    });
    access.reportRead('school', true);
    const previous = access.checkMaintain();
    expect(access.canShowMenu(matching)).toBe(true);

    await switchSession({
      authenticated: true,
      consent_required: true,
      csrf_token: 'a'.repeat(43),
      expires_at: '2030-01-01T00:00:00Z',
    });
    expect(pendingSignal?.aborted).toBe(true);
    complete?.(allowedMaintain());
    await previous;
    access.discover('/');
    await access.retryMaintain();
    expect(access.school.value).toBe('');
    expect(access.canShowMenu(matching)).toBe(false);
    expect(access.canShowMenu(settings)).toBe(false);
    expect(paths()).toEqual([maintainPath]);

    await switchSession({ ...sessionValue(false), content_school_id: 'new-school' });
    const currentApi = '/api/v1/catalog/admin/schools/new-school/teacher-sites';
    access.discover('/');
    await access.checkMaintain();
    await vi.waitFor(() => expect(access.canRead.value).toBe(true));
    expect(access.canMaintain.value).toBe(true);
    expect(paths()).toEqual([
      maintainPath,
      `${currentApi}/review/sites?limit=1`,
      `${currentApi}/allowlist`,
    ]);
  });
});
